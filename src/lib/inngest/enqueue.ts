import { and, eq } from 'drizzle-orm';
import { db, sources } from '@/db/db';
import { reprocessSource } from '@/lib/sources/process';
import { EVENTS, inngest } from './client';

// Enqueue a stored source for async analysis. Best-effort: if the queue is
// unreachable (misconfigured / dev server not running) we fall back to
// processing the source inline so it never gets stuck on `processing`. The
// normal path returns immediately and the worker does the AI work.
export async function enqueueSourceAnalysis(sourceId: string, ownerId: string): Promise<void> {
  try {
    await inngest.send({ name: EVENTS.sourceCreated, data: { sourceId, ownerId } });
  } catch (err) {
    console.error('[enqueue] inngest send failed — processing inline', sourceId, err);
    const [row] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.ownerId, ownerId)))
      .limit(1);
    if (row) {
      await reprocessSource(row).catch((e) =>
        console.error('[enqueue] inline fallback failed', sourceId, e),
      );
    }
  }
}
