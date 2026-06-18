import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { cases, db, sources } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { regenerateCaseSummary } from '@/lib/cases/summary';
import { getValidAccessToken } from '@/lib/outlook/tokens';
import { backfillOutlookEmailContent } from '@/lib/sources/fromEmail';
import { reprocessSource } from '@/lib/sources/process';

// POST /api/cases/[id]/reanalyze — re-run analysis (summary + Pass-1 fact
// extraction) for every source on the case, then regenerate the case
// summary from the refreshed Facts Store. Owner-scoped.
//
// Synchronous and sequential (one source at a time) to avoid hammering
// the Anthropic API; the client shows a spinner for the round trip. Each
// source re-runs independently — one failure doesn't stop the rest.

export const runtime = 'nodejs';
export const maxDuration = 300; // Pro plan limit; scales with source count.

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = await getCurrentUserId();

  const [caseRow] = await db
    .select({ id: cases.id, title: cases.title, caseType: cases.caseType })
    .from(cases)
    .where(and(eq(cases.id, params.id), eq(cases.ownerId, ownerId)))
    .limit(1);
  if (!caseRow) {
    return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(sources)
    .where(and(eq(sources.caseId, caseRow.id), eq(sources.ownerId, ownerId)));

  // Outlook token for backfilling email bodies that were stored before
  // raw_content existed (best-effort — null if the mailbox isn't
  // connected, in which case we just re-analyse from the preview).
  let outlookToken: string | null = null;
  try {
    outlookToken = await getValidAccessToken(ownerId, 'outlook');
  } catch {
    outlookToken = null;
  }

  let ready = 0;
  let failed = 0;
  let backfilled = 0;
  for (const row of rows) {
    let current = row;
    if (outlookToken) {
      current = await backfillOutlookEmailContent(row, outlookToken);
      if (current.rawContent && !row.rawContent) backfilled += 1;
    }
    const updated = await reprocessSource(current);
    if (updated.status === 'ready') ready += 1;
    else if (updated.status === 'failed') failed += 1;
  }

  // Roll the refreshed facts up into the case summary (best-effort).
  let summaryRegenerated = false;
  try {
    const result = await regenerateCaseSummary({
      caseId: caseRow.id,
      caseTitle: caseRow.title,
      caseType: caseRow.caseType,
      ownerId,
    });
    summaryRegenerated = Boolean(result);
  } catch (err) {
    console.error('[reanalyze] case summary regeneration failed', caseRow.id, err);
  }

  return NextResponse.json({ sources: rows.length, ready, failed, backfilled, summaryRegenerated });
}
