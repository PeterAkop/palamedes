import { toFile } from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { db, sources } from '@/db/db';
import { anthropic } from '@/lib/anthropic';
import { uploadSourceFile } from '@/lib/blob';
import type { OutlookAttachment } from '@/lib/outlook/graph';
import { DOCX_MIME, extractDocxText } from '@/lib/sources/docx';
import { summarizeFile, summarizeNote } from '@/lib/sources/summarize';

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

  const isImage = a.contentType.startsWith('image/');
  const kind: 'scan' | 'file' = isImage ? 'scan' : 'file';

  const [inserted] = await db
    .insert(sources)
    .values({
      caseId,
      ownerId,
      kind,
      title: a.name,
      metadata: {
        origin: 'outlook',
        attachment_of: emailExternalId,
        filename: a.name,
        mime_type: a.contentType,
        size_bytes: String(a.size),
      },
      externalId,
      status: 'processing',
    })
    .returning({ id: sources.id });

  try {
    const fileBuffer = Buffer.from(a.contentBytes, 'base64');
    if (fileBuffer.byteLength > MAX_BYTES) {
      throw new Error(`attachment too large (${fileBuffer.byteLength} bytes, max ${MAX_BYTES})`);
    }

    // Always archive the raw bytes to Blob (private).
    const { url: blobUrl } = await uploadSourceFile({
      filename: a.name,
      body: fileBuffer,
      contentType: a.contentType,
    });

    // Summarise the types Claude can read; store the rest without a
    // summary rather than failing the whole attachment.
    if (SUMMARIZABLE_MIME.has(a.contentType)) {
      const anthropicFile = await anthropic.beta.files.upload({
        file: await toFile(fileBuffer, a.name, { type: a.contentType }),
        betas: ['files-api-2025-04-14'],
      });
      const { summary, model } = await summarizeFile({
        title: a.name,
        mimeType: a.contentType,
        anthropicFileId: anthropicFile.id,
      });
      await db
        .update(sources)
        .set({
          status: 'ready',
          blobPath: blobUrl,
          anthropicFileId: anthropicFile.id,
          aiSummary: summary,
          aiSummaryModel: model,
          updatedAt: new Date(),
        })
        .where(eq(sources.id, inserted.id));
    } else if (a.contentType === DOCX_MIME) {
      // .docx → extract text locally, then summarise as text. Empty
      // extraction (image-only / unparsable doc) stays summary-less.
      const text = extractDocxText(fileBuffer);
      const update: Partial<typeof sources.$inferInsert> = {
        status: 'ready',
        blobPath: blobUrl,
        updatedAt: new Date(),
      };
      if (text.trim()) {
        const { summary, model } = await summarizeNote({ title: a.name, body: text });
        update.aiSummary = summary;
        update.aiSummaryModel = model;
      }
      await db.update(sources).set(update).where(eq(sources.id, inserted.id));
    } else {
      await db
        .update(sources)
        .set({ status: 'ready', blobPath: blobUrl, updatedAt: new Date() })
        .where(eq(sources.id, inserted.id));
    }
  } catch (err) {
    await db
      .update(sources)
      .set({
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : 'attachment ingest failed',
        updatedAt: new Date(),
      })
      .where(eq(sources.id, inserted.id));
  }
  return true;
}
