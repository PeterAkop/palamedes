import { and, desc, eq, inArray } from 'drizzle-orm';
import { cases, clients, db, sources } from '@/db/db';
import { getFirmDetails } from '@/lib/firm/queries';
import type { ToolContext } from '@/lib/tools/registry';

// Build the ToolContext for a generation: the case (title/type/AI
// summary), the client's name, and the selected source summaries. All
// owner-scoped. Returns null if the case isn't found / not owned.
//
// If `sourceIds` is omitted we fall back to every `ready` source on the
// case — a sensible default ("use everything") for a first draft.
export async function buildToolContext(
  caseId: string,
  ownerId: string,
  sourceIds: string[] | undefined,
  instructions: string | undefined,
): Promise<ToolContext | null> {
  const caseRows = await db
    .select({
      title: cases.title,
      caseType: cases.caseType,
      aiSummary: cases.aiSummary,
      ourReference: cases.ourReference,
      yourReference: cases.yourReference,
      clientFirst: clients.firstName,
      clientLast: clients.lastName,
    })
    .from(cases)
    .innerJoin(clients, eq(cases.clientId, clients.id))
    .where(and(eq(cases.id, caseId), eq(cases.ownerId, ownerId)))
    .limit(1);
  const c = caseRows[0];
  if (!c) return null;

  const baseWhere = and(
    eq(sources.caseId, caseId),
    eq(sources.ownerId, ownerId),
    eq(sources.status, 'ready'),
  );
  const sourceRows = await db
    .select({ title: sources.title, kind: sources.kind, aiSummary: sources.aiSummary })
    .from(sources)
    .where(
      sourceIds && sourceIds.length > 0
        ? and(baseWhere, inArray(sources.id, sourceIds))
        : baseWhere,
    )
    .orderBy(desc(sources.createdAt));

  const sourceSummaries = sourceRows
    .filter((s): s is { title: string; kind: string; aiSummary: string } => Boolean(s.aiSummary))
    .map((s) => ({ title: s.title, kind: s.kind, aiSummary: s.aiSummary }));

  const firm = await getFirmDetails(ownerId);

  return {
    caseTitle: c.title,
    caseType: c.caseType,
    clientName: `${c.clientFirst} ${c.clientLast}`,
    caseSummary: c.aiSummary ?? undefined,
    ourReference: c.ourReference ?? undefined,
    yourReference: c.yourReference ?? undefined,
    sourceSummaries,
    firm,
    instructions,
  };
}
