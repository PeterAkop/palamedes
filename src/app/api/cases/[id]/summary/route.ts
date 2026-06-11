import { and, desc, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { cases, db, sources } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { summarizeCase } from '@/lib/sources/summarize';

// POST /api/cases/[id]/summary — (re)generate the AI case summary by
// rolling up the per-source summaries with Haiku. Owner-scoped. Writes
// ai_summary / ai_summary_model / ai_summary_generated_at on the case;
// leaves the lawyer-authored `summary` untouched.
//
// 422 if the case has no `ready` sources to summarise (nothing to roll
// up yet — the UI should keep showing the empty-state).

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = await getCurrentUserId();

  const caseRows = await db
    .select({ id: cases.id, title: cases.title, caseType: cases.caseType })
    .from(cases)
    .where(and(eq(cases.id, params.id), eq(cases.ownerId, ownerId)))
    .limit(1);
  const caseRow = caseRows[0];
  if (!caseRow) {
    return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
  }

  // Only `ready` sources have an ai_summary worth rolling up.
  const readySources = await db
    .select({ title: sources.title, kind: sources.kind, aiSummary: sources.aiSummary })
    .from(sources)
    .where(
      and(
        eq(sources.caseId, caseRow.id),
        eq(sources.ownerId, ownerId),
        eq(sources.status, 'ready'),
      ),
    )
    .orderBy(desc(sources.createdAt));

  const usable = readySources.filter((s): s is { title: string; kind: string; aiSummary: string } =>
    Boolean(s.aiSummary),
  );
  if (usable.length === 0) {
    return NextResponse.json({ error: 'no_ready_sources' }, { status: 422 });
  }

  try {
    const { summary, model } = await summarizeCase({
      caseTitle: caseRow.title,
      caseType: caseRow.caseType,
      sources: usable,
    });
    const generatedAt = new Date();
    await db
      .update(cases)
      .set({
        aiSummary: summary,
        aiSummaryModel: model,
        aiSummaryGeneratedAt: generatedAt,
        updatedAt: generatedAt,
      })
      .where(eq(cases.id, caseRow.id));
    return NextResponse.json({
      aiSummary: summary,
      aiSummaryModel: model,
      aiSummaryGeneratedAt: generatedAt.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: 'summary_failed', message }, { status: 502 });
  }
}
