import { and, eq } from 'drizzle-orm';
import { db, sources } from '@/db/db';
import { reprocessSource } from '@/lib/sources/process';
import { EVENTS, inngest } from './client';

// Worker: analyse one stored source (summary + fact extraction) off the
// request path. Triggered by `source/created`. Concurrency is capped so a
// big pull/upload drains steadily without hammering the Anthropic API; on
// failure we re-throw so Inngest retries (reprocessSource is idempotent —
// it flips the row back to `processing` and tries again).
export const analyzeSource = inngest.createFunction(
  {
    id: 'analyze-source',
    name: 'Analyze source',
    triggers: [{ event: EVENTS.sourceCreated }],
    // Tune for throughput vs API limits. 3 ≈ "a few at a time".
    concurrency: { limit: 3 },
    retries: 3,
  },
  async ({ event }) => {
    const { sourceId, ownerId } = event.data as { sourceId: string; ownerId: string };

    const [row] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.ownerId, ownerId)))
      .limit(1);
    if (!row) return { skipped: 'not_found', sourceId };
    // Idempotent: a duplicate event for an already-analysed source is a no-op.
    if (row.status === 'ready') return { skipped: 'already_ready', sourceId };

    const updated = await reprocessSource(row);
    if (updated.status === 'failed') {
      // Surface as a thrown error so Inngest retries the analysis.
      throw new Error(updated.errorMessage ?? 'source analysis failed');
    }
    return { ok: true, sourceId };
  },
);

export const functions = [analyzeSource];
