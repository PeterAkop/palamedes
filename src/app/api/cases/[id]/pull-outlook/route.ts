import { and, eq, inArray } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { cases, clients, db, sources } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { listMessagesForEmail } from '@/lib/outlook/graph';
import { getValidAccessToken } from '@/lib/outlook/tokens';
import { createEmailSourceFromOutlook } from '@/lib/sources/fromEmail';

// POST /api/cases/[id]/pull-outlook — pull emails to/from the case's
// client address from the connected Outlook mailbox, create `email`
// sources tagged `origin: 'outlook'`, and Haiku-summarise each. Dedupes
// on the Graph message id (sources.external_id) so re-pulling is safe.
//
// POC limits: pulls the ~25 best `$search` matches (no pagination yet)
// and summarises synchronously — fine locally; a background job is a
// later concern if a mailbox is large.

export const runtime = 'nodejs';

const PULL_LIMIT = 25;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = getCurrentUserId();

  const [row] = await db
    .select({ caseId: cases.id, clientEmail: clients.email })
    .from(cases)
    .innerJoin(clients, eq(cases.clientId, clients.id))
    .where(and(eq(cases.id, params.id), eq(cases.ownerId, ownerId)))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
  if (!row.clientEmail) return NextResponse.json({ error: 'no_client_email' }, { status: 422 });

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(ownerId, 'outlook');
  } catch {
    return NextResponse.json({ error: 'outlook_not_connected' }, { status: 409 });
  }

  let messages: Awaited<ReturnType<typeof listMessagesForEmail>>;
  try {
    messages = await listMessagesForEmail(accessToken, row.clientEmail, PULL_LIMIT);
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
    await createEmailSourceFromOutlook({ caseId: row.caseId, ownerId, message: m });
  }

  return NextResponse.json({ imported: fresh.length, skipped: messages.length - fresh.length });
}
