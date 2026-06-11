import { and, desc, eq } from 'drizzle-orm';
import type { SourceKind, SourceStatus, Source as ViewSource } from '@/data/cases';
import { db, sources } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';

// Queries for sources. All owner-scoped (every row in the DB carries
// owner_id, and these helpers add the WHERE clause so callers don't
// have to). Same shape as the cases queries — the mapper translates
// DB rows (null, Date, generic text) into the view-model (undefined,
// ISO strings, narrowed unions).
//
// Order is `created_at desc` so the most-recently-added source shows
// at the top of the Sources tab — matches "what just came in" UX.

export async function listSourcesForCase(caseId: string): Promise<ViewSource[]> {
  const ownerId = await getCurrentUserId();
  const rows = await db
    .select()
    .from(sources)
    .where(and(eq(sources.caseId, caseId), eq(sources.ownerId, ownerId)))
    .orderBy(desc(sources.createdAt));
  return rows.map(toViewSource);
}

function toViewSource(row: typeof sources.$inferSelect): ViewSource {
  return {
    id: row.id,
    // Safe casts — the CHECK constraints on the sources table
    // guarantee these values are in the declared union.
    kind: row.kind as SourceKind,
    title: row.title,
    contentPreview: row.contentPreview ?? undefined,
    sourceReceivedAt: row.sourceReceivedAt?.toISOString(),
    metadata: row.metadata ?? undefined,
    status: row.status as SourceStatus,
    aiSummary: row.aiSummary ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    hasFile: Boolean(row.blobPath),
  };
}
