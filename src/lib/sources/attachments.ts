import { toFile } from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { db, sources } from '@/db/db';
import { anthropic } from '@/lib/anthropic';
import { uploadSourceFile } from '@/lib/blob';
import { enqueueSourceAnalysis } from '@/lib/inngest/enqueue';
import type { OutlookAttachment } from '@/lib/outlook/graph';
import { contentHash, findCaseSourceByContentHash } from '@/lib/sources/dedup';
import { DOCX_MIME } from '@/lib/sources/docx';

// Ingest one email file-attachment as a `file`/`scan` source — the same
// flow as a manual upload (Vercel Blob + Anthropic Files API + Haiku),
// but the bytes come from Graph's base64 `contentBytes` instead of a
// multipart upload. Invoked when an Outlook email is ingested via
// `createEmailSourceFromOutlook`.
//
// **Idempotent**: the source `external_id` is `<messageId>:att:<attId>`,
// so re-pulling the same email never re-adds its attachments. Returns
// `true` when a new source was created, `false` if it already existed.
//
// Types Anthropic can summarise (PDF + common images) get a Haiku
// summary; anything else is still stored to Blob and recorded as a
// `ready` source with no summary, so nothing is silently dropped.

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — mirrors the upload route

const SUMMARIZABLE_MIME: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export async function ingestEmailAttachment(args: {
  caseId: string;
  ownerId: string;
  emailExternalId: string;
  attachment: OutlookAttachment;
}): Promise<boolean> {
  const { caseId, ownerId, emailExternalId, attachment: a } = args;
  const externalId = `${emailExternalId}:att:${a.id}`;

  const [already] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.caseId, caseId), eq(sources.externalId, externalId)))
    .limit(1);
  if (already) return false;

  const fileBuffer = Buffer.from(a.contentBytes, 'base64');

  // Content-hash dedup across origins: the same file can reach a case more
  // than one way — e.g. a client upload is mirrored to the lawyer's mailbox
  // by the notification email, so a later pull would re-ingest it; or two
  // emails carry the same attachment. Skip when the case already has it.
  const hash = contentHash(fileBuffer);
  if (await findCaseSourceByContentHash(caseId, hash)) return false;

  const isImage = a.contentType.startsWith('image/');
  const kind: 'scan' | 'file' = isImage ? 'scan' : 'file';
  // Types we'll analyse (summary + facts) — the rest are stored without one.
  const analyzable = SUMMARIZABLE_MIME.has(a.contentType) || a.contentType === DOCX_MIME;
  const baseMeta = {
    origin: 'outlook',
    attachment_of: emailExternalId,
    filename: a.name,
    mime_type: a.contentType,
    size_bytes: String(a.size),
    content_sha256: hash,
  };

  // Oversized → record a visible failed source, don't process.
  if (fileBuffer.byteLength > MAX_BYTES) {
    await db.insert(sources).values({
      caseId,
      ownerId,
      kind,
      title: a.name,
      metadata: baseMeta,
      externalId,
      status: 'failed',
      errorMessage: `attachment too large (${fileBuffer.byteLength} bytes, max ${MAX_BYTES})`,
    });
    return true;
  }

  // Store half (fast): archive bytes to Blob, and upload Claude-readable
  // types to the Anthropic Files API so the queued analysis has the file id.
  // No inference here — summary + facts run on the queue (reprocessSource).
  let blobUrl: string;
  let anthropicFileId: string | null = null;
  try {
    ({ url: blobUrl } = await uploadSourceFile({
      filename: a.name,
      body: fileBuffer,
      contentType: a.contentType,
    }));
    if (SUMMARIZABLE_MIME.has(a.contentType)) {
      const f = await anthropic.beta.files.upload({
        file: await toFile(fileBuffer, a.name, { type: a.contentType }),
        betas: ['files-api-2025-04-14'],
      });
      anthropicFileId = f.id;
    }
  } catch (err) {
    await db.insert(sources).values({
      caseId,
      ownerId,
      kind,
      title: a.name,
      metadata: baseMeta,
      externalId,
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : 'attachment store failed',
    });
    return true;
  }

  const [inserted] = await db
    .insert(sources)
    .values({
      caseId,
      ownerId,
      kind,
      title: a.name,
      metadata: baseMeta,
      externalId,
      blobPath: blobUrl,
      anthropicFileId,
      status: analyzable ? 'processing' : 'ready',
    })
    .returning({ id: sources.id });

  if (analyzable) await enqueueSourceAnalysis(inserted.id, ownerId);
  return true;
}
