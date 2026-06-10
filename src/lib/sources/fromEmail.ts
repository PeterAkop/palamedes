import { eq } from 'drizzle-orm';
import { db, sources } from '@/db/db';
import type { OutlookMessage } from '@/lib/outlook/graph';
import { summarizePastedMessage } from '@/lib/sources/summarize';

// Create an `email` source from an Outlook message: insert (`processing`)
// → Haiku summary → `ready` (or `failed` with the error). Tagged
// `origin: 'outlook'` with the Graph message id as `external_id` for
// dedup. Shared by the per-case pull (`pull-outlook`) and triage-assign
// so both ingest emails identically.
export async function createEmailSourceFromOutlook(args: {
  caseId: string;
  ownerId: string;
  message: OutlookMessage;
}): Promise<void> {
  const { caseId, ownerId, message: m } = args;
  const from = m.fromAddress ?? m.fromName;

  const [inserted] = await db
    .insert(sources)
    .values({
      caseId,
      ownerId,
      kind: 'email',
      title: m.subject,
      contentPreview: m.bodyText.slice(0, 300),
      sourceReceivedAt: m.receivedDateTime ? new Date(m.receivedDateTime) : null,
      metadata: { origin: 'outlook', from, subject: m.subject },
      externalId: m.id,
      status: 'processing',
    })
    .returning({ id: sources.id });

  try {
    const { summary, model } = await summarizePastedMessage({
      kind: 'email',
      title: m.subject,
      body: m.bodyText,
      from,
      subject: m.subject,
    });
    await db
      .update(sources)
      .set({ status: 'ready', aiSummary: summary, aiSummaryModel: model, updatedAt: new Date() })
      .where(eq(sources.id, inserted.id));
  } catch (err) {
    await db
      .update(sources)
      .set({
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : 'summary failed',
        updatedAt: new Date(),
      })
      .where(eq(sources.id, inserted.id));
  }
}
