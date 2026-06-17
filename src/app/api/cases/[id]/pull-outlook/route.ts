import { and, eq, inArray } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { cases, clients, db, sources } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { type CaseSearchTerms, listMessagesForCase } from '@/lib/outlook/graph';
import { getValidAccessToken } from '@/lib/outlook/tokens';
import { createEmailSourceFromOutlook } from '@/lib/sources/fromEmail';

// POST /api/cases/[id]/pull-outlook — pull case-related emails from the
// connected Outlook mailbox, create `email` sources tagged
// `origin: 'outlook'`, and Haiku-summarise each. Dedupes on the Graph
// message id (sources.external_id) so re-pulling is safe.
//
// Matching (see listMessagesForCase): the client as a participant OR the
// client's full name / a matter reference in the subject — so mail the
// client's address isn't on (e.g. the lawyer writing from another
// mailbox) still lands on the case. Paginated up to a cap; summarises
// synchronously — fine locally, a background job is a later concern.

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = await getCurrentUserId();

  const [row] = await db
    .select({
      caseId: cases.id,
      clientEmail: clients.email,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      ourReference: cases.ourReference,
      yourReference: cases.yourReference,
      homeOfficeReference: cases.homeOfficeReference,
    })
    .from(cases)
    .innerJoin(clients, eq(cases.clientId, clients.id))
    .where(and(eq(cases.id, params.id), eq(cases.ownerId, ownerId)))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'case_not_found' }, { status: 404 });

  const clientName = [row.clientFirstName, row.clientLastName]
    .map((n) => n?.trim())
    .filter(Boolean)
    .join(' ');
  const references = [row.ourReference, row.yourReference, row.homeOfficeReference]
    .map((r) => r?.trim())
    .filter((r): r is string => Boolean(r));
  const terms: CaseSearchTerms = {
    clientEmail: row.clientEmail ?? undefined,
    clientName: clientName || undefined,
    references,
  };
  // Nothing to match on — no email, no name, no reference.
  if (!terms.clientEmail && !terms.clientName && references.length === 0) {
    return NextResponse.json({ error: 'no_search_terms' }, { status: 422 });
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(ownerId, 'outlook');
  } catch {
    return NextResponse.json({ error: 'outlook_not_connected' }, { status: 409 });
  }

  let messages: Awaited<ReturnType<typeof listMessagesForCase>>;
  try {
    messages = await listMessagesForCase(accessToken, terms);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'graph error';
    return NextResponse.json({ error: 'graph_failed', message }, { status: 502 });
  }

  if (messages.length === 0) return NextResponse.json({ imported: 0, skipped: 0 });

  // Dedupe: which of these Graph ids are already sources on this case?
  const ids = messages.map((m) => m.id);
  const existingRows = await db
    .select({ externalId: sources.externalId })
    .from(sources)
    .where(and(eq(sources.caseId, row.caseId), inArray(sources.externalId, ids)));
  const seen = new Set(existingRows.map((e) => e.externalId));
  const fresh = messages.filter((m) => !seen.has(m.id));

  for (const m of fresh) {
    await createEmailSourceFromOutlook({ caseId: row.caseId, ownerId, message: m, accessToken });
  }

  return NextResponse.json({ imported: fresh.length, skipped: messages.length - fresh.length });
}
