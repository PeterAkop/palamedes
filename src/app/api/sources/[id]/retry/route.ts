import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { db, sources } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { summarizeSource } from '@/lib/sources/process';

// POST /api/sources/[id]/retry — re-run the Haiku summary for a source.
// Primary use is recovering a `failed` row (transient Anthropic error,
// etc.), but it works for any source. Same processing → ready/failed
// lifecycle as the ingestion routes; dispatch-by-kind lives in
// summarizeSource (src/lib/sources/process.ts).

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = getCurrentUserId();

  const rows = await db
    .select()
    .from(sources)
    .where(and(eq(sources.id, params.id), eq(sources.ownerId, ownerId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: 'source_not_found' }, { status: 404 });
  }

  // Flip to processing + clear any prior error so the UI shows the
  // spinner immediately on refresh.
  await db
    .update(sources)
    .set({ status: 'processing', errorMessage: null, updatedAt: new Date() })
    .where(eq(sources.id, row.id));

  try {
    const { summary, model } = await summarizeSource(row);
    const [updated] = await db
      .update(sources)
      .set({
        status: 'ready',
        aiSummary: summary,
        aiSummaryModel: model,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, row.id))
      .returning();
    return NextResponse.json({ source: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    await db
      .update(sources)
      .set({ status: 'failed', errorMessage: message, updatedAt: new Date() })
      .where(eq(sources.id, row.id));
    return NextResponse.json({ error: 'summary_failed', message }, { status: 502 });
  }
}
