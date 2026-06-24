import { eq } from 'drizzle-orm';
import { db, type Source, sources } from '@/db/db';
import { getSourceFileStream } from '@/lib/blob';
import { type ExtractInput, extractAndStoreFacts, extractInputFromRow } from '@/lib/facts/extract';
import { DOCX_MIME, extractDocxText } from '@/lib/sources/docx';
import {
  type SummarizeResult,
  summarizeFile,
  summarizeNote,
  summarizePastedMessage,
} from '@/lib/sources/summarize';

// Re-summarize an existing source row by dispatching on its `kind`.
// Used by the retry route (POST /api/sources/[id]/retry) so a `failed`
// source can be re-processed without re-uploading. The original
// ingestion routes (notes/paste/upload) call the summarizers directly
// with the freshly-submitted payload; this helper is the
// summarize-from-stored-row path.
//
// Text kinds (note / email / whatsapp) re-summarize from the persisted
// full body (`raw_content`), falling back to `content_preview` only for
// rows created before raw_content existed. File kinds retry at full
// fidelity via the stored Anthropic Files API id.
export async function summarizeSource(row: Source): Promise<SummarizeResult> {
  const metadata = (row.metadata ?? {}) as Record<string, string | undefined>;

  switch (row.kind) {
    case 'file':
    case 'scan': {
      // .docx has no Anthropic file id — re-summarize from the stored
      // blob by extracting its text (same as fresh ingestion).
      if (metadata.mime_type === DOCX_MIME) {
        if (!row.blobPath) {
          throw new Error('Cannot re-summarize docx: no blob stored');
        }
        const file = await getSourceFileStream(row.blobPath);
        if (!file) throw new Error('docx blob unavailable');
        const buf = Buffer.from(await new Response(file.stream).arrayBuffer());
        const text = extractDocxText(buf);
        if (!text.trim()) throw new Error('docx has no extractable text');
        return summarizeNote({ title: row.title, body: text });
      }
      if (!row.anthropicFileId) {
        throw new Error('Cannot re-summarize file source: no anthropic_file_id stored');
      }
      return summarizeFile({
        title: row.title,
        mimeType: metadata.mime_type ?? 'application/pdf',
        anthropicFileId: row.anthropicFileId,
      });
    }
    case 'email':
    case 'whatsapp':
      return summarizePastedMessage({
        kind: row.kind,
        title: row.title,
        body: row.rawContent ?? row.contentPreview ?? '',
        from: metadata.from,
        subject: metadata.subject,
        fromPhone: metadata.from_phone,
      });
    default:
      // 'note' (and any future plain-text kind)
      return summarizeNote({
        title: row.title,
        body: row.rawContent ?? row.contentPreview ?? '',
      });
  }
}

// Re-run a stored source end-to-end: flip to `processing`, re-summarise
// and re-extract facts (Pass 1), landing it `ready` or `failed`. Shared by
// the per-source retry route and the whole-case re-analyse route. Facts
// extraction is best-effort and won't flip a summarised source to failed.
// Returns the final row.
export async function reprocessSource(row: Source): Promise<Source> {
  await db
    .update(sources)
    .set({ status: 'processing', errorMessage: null, updatedAt: new Date() })
    .where(eq(sources.id, row.id));

  let updated: Source;
  try {
    const { summary, model } = await summarizeSource(row);
    [updated] = await db
      .update(sources)
      .set({ status: 'ready', aiSummary: summary, aiSummaryModel: model, updatedAt: new Date() })
      .where(eq(sources.id, row.id))
      .returning();
  } catch (err) {
    [updated] = await db
      .update(sources)
      .set({
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : 'analysis failed',
        updatedAt: new Date(),
      })
      .where(eq(sources.id, row.id))
      .returning();
    return updated;
  }

  // Pass 1 — re-extract facts (best-effort; the source is already ready).
  const input = await buildExtractInput(row);
  if (input) {
    await extractAndStoreFacts({ id: row.id, caseId: row.caseId, ownerId: row.ownerId }, input);
  }
  return updated;
}

// Build the fact-extraction input for a stored row. `extractInputFromRow`
// can't handle docx (no Anthropic file id), so for a docx source we read the
// text back from the blob — otherwise a docx that's analysed via the queue
// would get a summary but no extracted facts.
async function buildExtractInput(row: Source): Promise<ExtractInput | null> {
  const base = extractInputFromRow(row);
  if (base) return base;

  const meta = (row.metadata ?? {}) as Record<string, string | undefined>;
  if (
    (row.kind === 'file' || row.kind === 'scan') &&
    meta.mime_type === DOCX_MIME &&
    row.blobPath
  ) {
    const file = await getSourceFileStream(row.blobPath);
    if (!file) return null;
    const buf = Buffer.from(await new Response(file.stream).arrayBuffer());
    const text = extractDocxText(buf);
    if (!text.trim()) return null;
    return { mode: 'text', kind: 'note', title: row.title, body: text };
  }
  return null;
}
