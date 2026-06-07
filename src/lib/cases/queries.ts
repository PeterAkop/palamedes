import { and, asc, eq } from 'drizzle-orm';
import type {
  CaseStatus,
  CaseType,
  SidebarItem,
  Case as ViewCase,
  Client as ViewClient,
  Source as ViewSource,
} from '@/data/cases';
import { cases, clients, db } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { listSourcesForCase } from '@/lib/sources/queries';

// Queries for cases / clients. All scoped to the current owner —
// every row in the DB carries owner_id, and these helpers add the
// WHERE clause so callers don't have to. When real auth lands the
// only change is `getCurrentUserId()` returning a real user id.
//
// The mappers below translate from the Drizzle-inferred row shape
// (text columns for case_type / status, `null` for nullable fields,
// `Date` for timestamps) into the view-model in `@/data/cases` (
// narrowed unions, `undefined` for missing, ISO strings for
// timestamps). Sources / generations are stubbed to empty arrays —
// their tables land in their own phase; the consumer components
// already render empty states.

// --- Sidebar --------------------------------------------------------------

export async function listSidebarItems(): Promise<SidebarItem[]> {
  const ownerId = getCurrentUserId();
  const rows = await db
    .select({
      caseId: cases.id,
      caseTitle: cases.title,
      caseStatus: cases.status,
      clientSurname: clients.lastName,
      createdAt: cases.createdAt,
    })
    .from(cases)
    .innerJoin(clients, eq(cases.clientId, clients.id))
    .where(eq(cases.ownerId, ownerId))
    .orderBy(asc(cases.createdAt));

  return rows.map((r) => ({
    caseId: r.caseId,
    caseTitle: r.caseTitle,
    caseStatus: r.caseStatus as CaseStatus,
    clientSurname: r.clientSurname,
  }));
}

// --- Case detail ----------------------------------------------------------

export async function getCaseById(id: string): Promise<ViewCase | undefined> {
  const ownerId = getCurrentUserId();
  const rows = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.ownerId, ownerId)))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  // Sources land via the dedicated sources query — ownership is
  // re-checked there for defense in depth (even though we just
  // verified it for this case row).
  const sourcesList = await listSourcesForCase(id);
  return toViewCase(row, sourcesList);
}

export async function getClientById(id: string): Promise<ViewClient | undefined> {
  const ownerId = getCurrentUserId();
  const rows = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.ownerId, ownerId)))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toViewClient(row);
}

// --- Mappers --------------------------------------------------------------

function toViewCase(row: typeof cases.$inferSelect, sourcesList: ViewSource[]): ViewCase {
  return {
    id: row.id,
    clientId: row.clientId,
    title: row.title,
    // Safe casts — the CHECK constraints on the cases table guarantee
    // these values are in the declared union.
    caseType: row.caseType as CaseType,
    status: row.status as CaseStatus,
    homeOfficeReference: row.homeOfficeReference ?? undefined,
    deadline: row.deadline ?? undefined,
    summary: row.summary ?? undefined,
    aiSummary: row.aiSummary ?? undefined,
    aiSummaryGeneratedAt: row.aiSummaryGeneratedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sources: sourcesList,
    // Generations don't have tables yet — empty array; the Tools tab
    // empty-state branch renders. Drops in the next phase (feat/tools).
    generations: [],
  };
}

function toViewClient(row: typeof clients.$inferSelect): ViewClient {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    dateOfBirth: row.dateOfBirth ?? undefined,
    nationality: row.nationality ?? undefined,
    preferredLanguage: row.preferredLanguage ?? undefined,
  };
}
