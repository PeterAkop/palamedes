import type { Source } from '@/db/db';
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
// Limitation: for text kinds (note / email / whatsapp) we only have
// `content_preview` (the leading 300 chars stored at insert), not the
// full original body — Palamedes doesn't persist raw text today. Retry
// therefore re-summarizes from the preview. That's faithful for short
// notes and good enough for the common case (retrying a transient
// Anthropic API failure); a `raw_content` column would make it exact
// and is a candidate for a later slice. File kinds retry at full
// fidelity via the stored Anthropic Files API id.
export async function summarizeSource(row: Source): Promise<SummarizeResult> {
  const metadata = (row.metadata ?? {}) as Record<string, string | undefined>;

  switch (row.kind) {
    case 'file':
    case 'scan': {
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
        body: row.contentPreview ?? '',
        from: metadata.from,
        subject: metadata.subject,
        fromPhone: metadata.from_phone,
      });
    default:
      // 'note' (and any future plain-text kind)
      return summarizeNote({
        title: row.title,
        body: row.contentPreview ?? '',
      });
  }
}
