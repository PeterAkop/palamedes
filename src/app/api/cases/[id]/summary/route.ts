import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { cases, db } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { regenerateCaseSummary } from '@/lib/cases/summary';

// POST /api/cases/[id]/summary — (re)generate the AI case summary.
// Owner-scoped. Generation logic (facts-first, prose fallback) + the
// cases.ai_summary* write live in regenerateCaseSummary, shared with the
// whole-case re-analyse route.
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

  try {
    const result = await regenerateCaseSummary({
      caseId: caseRow.id,
      caseTitle: caseRow.title,
      caseType: caseRow.caseType,
      ownerId,
    });
    if (!result) {
      return NextResponse.json({ error: 'no_ready_sources' }, { status: 422 });
    }
    return NextResponse.json({
      aiSummary: result.aiSummary,
      aiSummaryModel: result.aiSummaryModel,
      aiSummaryGeneratedAt: result.aiSummaryGeneratedAt.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: 'summary_failed', message }, { status: 502 });
  }
}
