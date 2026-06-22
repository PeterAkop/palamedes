import { and, desc, eq } from 'drizzle-orm';
import { cases, db, sources } from '@/db/db';
import { formatCaseFactsForPrompt, getCaseFacts } from '@/lib/facts/case';
import { consolidateCaseActionItems } from '@/lib/facts/consolidate';
import { summarizeCase, summarizeCaseFromFacts } from '@/lib/sources/summarize';

// Regenerate a case's AI summary and write the cases.ai_summary* columns.
// Preferred path: generate from the structured Facts Store (deterministic
// → consistent). Falls back to the per-source prose roll-up for cases with
// no extracted facts yet. Returns null when there's nothing to summarise
// (no facts and no ready source summaries). Shared by the case-summary
// route and the whole-case re-analyse route.

export interface RegeneratedSummary {
  aiSummary: string;
  aiSummaryModel: string;
  aiSummaryGeneratedAt: Date;
}

export async function regenerateCaseSummary(args: {
  caseId: string;
  caseTitle: string;
  caseType: string;
  ownerId: string;
}): Promise<RegeneratedSummary | null> {
  const { caseId, caseTitle, caseType, ownerId } = args;

  // Refresh the consolidated action plan alongside the summary
  // (best-effort — a failure here must not block the summary).
  await consolidateCaseActionItems(caseId, ownerId).catch((err) =>
    console.error('[action plan] consolidation failed', caseId, err),
  );

  const caseFacts = await getCaseFacts(caseId, ownerId);

  // Fallback inputs: per-source prose summaries, for cases whose sources
  // predate fact extraction.
  const readySources = await db
    .select({ title: sources.title, kind: sources.kind, aiSummary: sources.aiSummary })
    .from(sources)
    .where(
      and(eq(sources.caseId, caseId), eq(sources.ownerId, ownerId), eq(sources.status, 'ready')),
    )
    .orderBy(desc(sources.createdAt));
  const usableSummaries = readySources.filter(
    (s): s is { title: string; kind: string; aiSummary: string } => Boolean(s.aiSummary),
  );

  if (caseFacts.length === 0 && usableSummaries.length === 0) return null;

  const { summary, model } =
    caseFacts.length > 0
      ? await summarizeCaseFromFacts({
          caseTitle,
          caseType,
          factsSheet: formatCaseFactsForPrompt(caseFacts),
        })
      : await summarizeCase({ caseTitle, caseType, sources: usableSummaries });

  const generatedAt = new Date();
  await db
    .update(cases)
    .set({
      aiSummary: summary,
      aiSummaryModel: model,
      aiSummaryGeneratedAt: generatedAt,
      updatedAt: generatedAt,
    })
    .where(eq(cases.id, caseId));

  return { aiSummary: summary, aiSummaryModel: model, aiSummaryGeneratedAt: generatedAt };
}
