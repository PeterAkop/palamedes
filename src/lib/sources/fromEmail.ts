import { and, eq } from 'drizzle-orm';
import { db, type Source, sources } from '@/db/db';
import { enqueueSourceAnalysis } from '@/lib/inngest/enqueue';
import { getMessageById, listMessageAttachments, type OutlookMessage } from '@/lib/outlook/graph';
import { ingestEmailAttachment } from '@/lib/sources/attachments';

// Create an `email` source from an Outlook message: insert (`processing`)
// then hand the AI analysis (summary + fact extraction) to the queue, so a
// pull of many emails returns fast instead of blocking on inference. Tagged
// `origin: 'outlook'` with the Graph message id as `external_id` for
// dedup. Used by the per-case Outlook pull (`pull-outlook`).
//
// If the message has file attachments and an `accessToken` is provided,
// each attachment is also ingested as its own `file`/`scan` source (see
// `ingestEmailAttachment`). Attachment ingest only runs when the email
// is freshly created, so re-pulls don't re-add them.
//
// **Idempotent**: if this message (`external_id`) is already a source on
// the case, it's a no-op (returns `false`). This is the single dedup
// point — so the same email can never be added to a case twice across
// repeated pulls. Returns `true` when a new source was created.
export async function createEmailSourceFromOutlook(args: {
  caseId: string;
  ownerId: string;
  message: OutlookMessage;
  accessToken?: string;
}): Promise<boolean> {
  const { caseId, ownerId, message: m, accessToken } = args;
  const from = m.fromAddress ?? m.fromName;

  const [already] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.caseId, caseId), eq(sources.externalId, m.id)))
    .limit(1);
  if (already) return false;

  const [inserted] = await db
    .insert(sources)
    .values({
      caseId,
      ownerId,
      kind: 'email',
      title: m.subject,
      contentPreview: m.bodyText.slice(0, 300),
      rawContent: m.bodyText,
      sourceReceivedAt: m.receivedDateTime ? new Date(m.receivedDateTime) : null,
      metadata: { origin: 'outlook', from, subject: m.subject },
      externalId: m.id,
      status: 'processing',
    })
    .returning({ id: sources.id });

  // Hand off analysis (summary + fact extraction) to the queue — the row is
  // already stored with its full body, so this returns immediately and the
  // worker fills in the summary/facts (flips processing → ready/failed).
  await enqueueSourceAnalysis(inserted.id, ownerId);

  // Ingest file attachments as their own sources. Inline images (e.g.
  // signature logos) are skipped. A failure here is swallowed per
  // attachment inside ingestEmailAttachment, and the whole block is
  // guarded so a Graph hiccup never undoes the email source itself.
  if (accessToken && m.hasAttachments) {
    try {
      const attachments = await listMessageAttachments(accessToken, m.id);
      for (const att of attachments) {
        if (att.isInline) continue;
        await ingestEmailAttachment({ caseId, ownerId, emailExternalId: m.id, attachment: att });
      }
    } catch {
      // attachment ingest is best-effort; the email source already exists
    }
  }

  return true;
}

// Backfill the full body of an existing Outlook `email` source that was
// stored before raw_content existed, so re-analysis runs on the real
// content rather than the 300-char preview. Re-fetches the message from
// Outlook by its Graph id, writes raw_content + a fresh content_preview,
// and returns the updated row. No-op (returns the row unchanged) when the
// source isn't an Outlook email, has no Graph id, or already has content.
// Best-effort: a Graph failure (e.g. the message was deleted) returns the
// row as-is so the caller can still re-analyse from the preview.
export async function backfillOutlookEmailContent(
  row: Source,
  accessToken: string,
): Promise<Source> {
  const meta = (row.metadata ?? {}) as Record<string, string | undefined>;
  if (row.kind !== 'email' || meta.origin !== 'outlook' || !row.externalId || row.rawContent) {
    return row;
  }

  try {
    const m = await getMessageById(accessToken, row.externalId);
    const [updated] = await db
      .update(sources)
      .set({
        rawContent: m.bodyText,
        contentPreview: m.bodyText.slice(0, 300),
        updatedAt: new Date(),
      })
      .where(eq(sources.id, row.id))
      .returning();
    return updated ?? row;
  } catch (err) {
    console.warn('[email backfill failed]', row.id, err);
    return row;
  }
}
