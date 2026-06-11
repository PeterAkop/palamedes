import { and, asc, eq, inArray } from 'drizzle-orm';
import type {
  GenerationStatus,
  Generation as ViewGeneration,
  GenerationMessage as ViewGenerationMessage,
} from '@/data/cases';
import { db, generationMessages, generations } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';

// Owner-scoped generations for a case, each with its message thread,
// mapped into the `Generation` view-model in @/data/cases. Replaces the
// `generations: []` stub the cases query used before the Tools tab
// landed. Ordered oldest-first so the Tools tab can show v1, v2, … in
// run order; messages within a generation are oldest-first (draft
// request → draft → refinements).
export async function listGenerationsForCase(caseId: string): Promise<ViewGeneration[]> {
  const ownerId = await getCurrentUserId();

  const genRows = await db
    .select()
    .from(generations)
    .where(and(eq(generations.caseId, caseId), eq(generations.ownerId, ownerId)))
    .orderBy(asc(generations.createdAt));

  if (genRows.length === 0) return [];

  const msgRows = await db
    .select()
    .from(generationMessages)
    .where(
      inArray(
        generationMessages.generationId,
        genRows.map((g) => g.id),
      ),
    )
    .orderBy(asc(generationMessages.createdAt));

  const messagesByGeneration = new Map<string, ViewGenerationMessage[]>();
  for (const m of msgRows) {
    const bucket = messagesByGeneration.get(m.generationId) ?? [];
    bucket.push({ role: m.role as ViewGenerationMessage['role'], content: m.content });
    messagesByGeneration.set(m.generationId, bucket);
  }

  return genRows.map((g) => ({
    id: g.id,
    toolId: g.toolId,
    version: g.version,
    // Safe cast — CHECK constraint guarantees the union.
    status: g.status as GenerationStatus,
    model: g.model,
    createdAt: g.createdAt.toISOString(),
    messages: messagesByGeneration.get(g.id) ?? [],
  }));
}
