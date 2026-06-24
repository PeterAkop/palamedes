import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { db, type Source, sources } from '@/db/db';
import { anthropic } from '@/lib/anthropic';
import { uploadSourceFile } from '@/lib/blob';
import { enqueueSourceAnalysis } from '@/lib/inngest/enqueue';
import { contentHash, findCaseSourceByContentHash } from '@/lib/sources/dedup';
import { DOCX_MIME } from '@/lib/sources/docx';

// Shared file-upload ingest + security validation. Used by the
// authenticated upload route and the public client-upload route, so both
// apply the same allow-list and produce identical `file`/`scan` sources.

// --- Security: what a client is allowed to upload -------------------------
// Documents and images only. Never scripts, markup, or executables — the
// public endpoint must not become a vector for malicious files. We check
// the extension AND the MIME type, and keep an explicit block-list as
// defence in depth.

const ACCEPTED_MIME: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'text/plain',
]);

const ACCEPTED_EXT = new Set([
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'heic',
  'docx',
  'doc',
  'xlsx',
  'xls',
  'txt',
]);

// Explicitly rejected regardless of the declared MIME type — scripts,
// markup that can carry script, and executables.
const BLOCKED_EXT = new Set([
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'html',
  'htm',
  'xhtml',
  'svg',
  'xml',
  'php',
  'phtml',
  'exe',
  'bat',
  'cmd',
  'com',
  'scr',
  'msi',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'wsf',
  'jar',
  'app',
  'dmg',
  'pkg',
  'deb',
  'rpm',
  'apk',
  'py',
  'rb',
  'pl',
  'dll',
  'so',
  'bin',
  'reg',
  'lnk',
  'iso',
]);

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file

export interface UploadValidationError {
  code: string;
  message: string;
}

function extOf(name: string): string {
  return name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
}

export function validateUploadFile(file: File): UploadValidationError | null {
  const ext = extOf(file.name ?? '');
  if (file.size === 0) return { code: 'empty_file', message: 'The file is empty.' };
  if (file.size > MAX_BYTES) {
    return { code: 'file_too_large', message: 'Each file must be 25 MB or smaller.' };
  }
  if (BLOCKED_EXT.has(ext)) {
    return { code: 'blocked_type', message: `For security, .${ext} files are not allowed.` };
  }
  if (ext && !ACCEPTED_EXT.has(ext)) {
    return { code: 'unsupported_type', message: `.${ext} files are not supported.` };
  }
  if (!ACCEPTED_MIME.has(file.type)) {
    return {
      code: 'unsupported_type',
      message: `Files of type "${file.type || 'unknown'}" are not supported.`,
    };
  }
  return null;
}

// Strip any path and unusual characters from a client-supplied filename.
function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? 'file').trim();
  return base.replace(/[^\w.\-() ]/g, '_').slice(0, 200) || 'file';
}

const ANTHROPIC_READABLE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

// Ingest one uploaded file as a source on the case: store the bytes in
// Blob, then (where the type allows) summarise with Haiku and extract
// facts. Returns the final `ready`/`failed` row. Assumes the file already
// passed validateUploadFile.
export async function ingestFileSource(args: {
  caseId: string;
  ownerId: string;
  file: File;
  title?: string;
  origin?: string; // e.g. 'client-upload'
  // Pre-read bytes. Callers that also need the bytes (e.g. to mirror the
  // upload to the lawyer by email) read the File once and pass them here so
  // we don't buffer the same File twice.
  buffer?: Buffer;
}): Promise<Source> {
  const { caseId, ownerId, file, origin } = args;
  const filename = sanitizeFilename(file.name || 'file');
  const title = args.title?.trim() || filename;
  const kind: 'scan' | 'file' = file.type.startsWith('image/') ? 'scan' : 'file';

  const fileBuffer = args.buffer ?? Buffer.from(await file.arrayBuffer());

  // Content-hash dedup: if these exact bytes are already a source on this
  // case (any origin), return that row instead of creating a duplicate.
  const hash = contentHash(fileBuffer);
  const dupeId = await findCaseSourceByContentHash(caseId, hash);
  if (dupeId) {
    const [existing] = await db.select().from(sources).where(eq(sources.id, dupeId)).limit(1);
    if (existing) return existing;
  }

  const metadata: Record<string, string> = {
    mime_type: file.type,
    size_bytes: String(file.size),
    filename,
    content_sha256: hash,
  };
  if (origin) metadata.origin = origin;

  // Types we'll analyse (summary + facts). Others are stored without one.
  const analyzable = ANTHROPIC_READABLE.has(file.type) || file.type === DOCX_MIME;

  // Store half (fast): archive to Blob + upload Claude-readable types to the
  // Anthropic Files API so the queued analysis has the file id. No inference
  // here — summary + facts run on the queue (reprocessSource).
  let blobUrl: string;
  let anthropicFileId: string | null = null;
  try {
    ({ url: blobUrl } = await uploadSourceFile({
      filename,
      body: fileBuffer,
      contentType: file.type,
    }));
    if (ANTHROPIC_READABLE.has(file.type)) {
      const f = await anthropic.beta.files.upload({
        file: await toFile(fileBuffer, filename, { type: file.type }),
        betas: ['files-api-2025-04-14'],
      });
      anthropicFileId = f.id;
    }
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `Anthropic ${err.status ?? ''}: ${err.message}`.trim()
        : err instanceof Error
          ? err.message
          : 'unknown error';
    const [failed] = await db
      .insert(sources)
      .values({ caseId, ownerId, kind, title, metadata, status: 'failed', errorMessage: message })
      .returning();
    return failed;
  }

  const [inserted] = await db
    .insert(sources)
    .values({
      caseId,
      ownerId,
      kind,
      title,
      metadata,
      blobPath: blobUrl,
      anthropicFileId,
      status: analyzable ? 'processing' : 'ready',
    })
    .returning();

  if (analyzable) await enqueueSourceAnalysis(inserted.id, ownerId);
  return inserted;
}
