import { and, desc, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { cases, db, sources } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { formatCaseFactsForPrompt, getCaseFacts } from '@/lib/facts/case';
import { summarizeCase, summarizeCaseFromFacts } from '@/lib/sources/summarize';

// POST /api/cases/[id]/summary — (re)generate the AI case summary.
// Owner-scoped. Writes ai_summary / ai_summary_model /
// ai_summary_generated_at on the case; leaves the lawyer-authored
// `summary` untouched.
//
// Preferred path (Pass 2): generate from the structured Facts Store
// (deterministic → consistent). Falls back to rolling up the per-source
// prose summaries when a case has no extracted facts yet (e.g. sources
// predating fact extraction).
//
// 422 if the case has nothing to summarise (no facts and no `ready`
// sources) — the UI should keep showing the empty-state.

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

  // Preferred path: generate from the structured Facts Store.
  const caseFacts = await getCaseFacts(caseRow.id, ownerId);

  // Fallback inputs: per-source prose summaries, for cases whose sources
  // were ingested before fact extraction existed.
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
  const usableSummaries = readySources.filter(
    (s): s is { title: string; kind: string; aiSummary: string } => Boolean(s.aiSummary),
  );

  if (caseFacts.length === 0 && usableSummaries.length === 0) {
    return NextResponse.json({ error: 'no_ready_sources' }, { status: 422 });
  }

  try {
    const { summary, model } =
      caseFacts.length > 0
        ? await summarizeCaseFromFacts({
            caseTitle: caseRow.title,
            caseType: caseRow.caseType,
            factsSheet: formatCaseFactsForPrompt(caseFacts),
          })
        : await summarizeCase({
            caseTitle: caseRow.title,
            caseType: caseRow.caseType,
            sources: usableSummaries,
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
