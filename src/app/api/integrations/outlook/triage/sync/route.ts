import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { cases, clients, db, mailboxMessages } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { listRecentMessages } from '@/lib/outlook/graph';
import { getValidAccessToken } from '@/lib/outlook/tokens';
import { type CaseCandidate, suggestCaseForMessage } from '@/lib/triage/suggest';

// POST /api/integrations/outlook/triage/sync — pull the most-recent
// mailbox messages into the triage inbox as `pending` items (skipping any
// already tracked), then ask Haiku to suggest a case for each new one.
// Owner-scoped. POC: caps at the 25 most recent and suggests synchronously
// (a background job is the later move for large mailboxes).

export const runtime = 'nodejs';

const SYNC_LIMIT = 25;

export async function POST() {
  const ownerId = getCurrentUserId();

  let token: string;
  try {
    token = await getValidAccessToken(ownerId, 'outlook');
  } catch {
    return NextResponse.json({ error: 'outlook_not_connected' }, { status: 409 });
  }

  let recent: Awaited<ReturnType<typeof listRecentMessages>>;
  try {
    recent = await listRecentMessages(token, SYNC_LIMIT);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'graph error';
    return NextResponse.json({ error: 'graph_failed', message }, { status: 502 });
  }
  if (recent.length === 0) return NextResponse.json({ added: 0 });

  // Skip messages already tracked (pending / assigned / ignored).
  const existing = await db
    .select({ externalId: mailboxMessages.externalId })
    .from(mailboxMessages)
    .where(
      and(
        eq(mailboxMessages.ownerId, ownerId),
        inArray(
          mailboxMessages.externalId,
          recent.map((m) => m.id),
        ),
      ),
    );
  const seen = new Set(existing.map((e) => e.externalId));
  const fresh = recent.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return NextResponse.json({ added: 0 });

  await db
    .insert(mailboxMessages)
    .values(
      fresh.map((m) => ({
        ownerId,
        provider: 'outlook',
        externalId: m.id,
        conversationId: m.conversationId ?? null,
        fromAddress: m.fromAddress ?? null,
        fromName: m.fromName ?? null,
        subject: m.subject,
        receivedAt: m.receivedDateTime ? new Date(m.receivedDateTime) : null,
        snippet: m.snippet,
        status: 'pending',
      })),
    )
    .onConflictDoNothing();

  // Build the candidate set (owner's cases) once.
  const caseRows = await db
    .select({
      id: cases.id,
      caseType: cases.caseType,
      aiSummary: cases.aiSummary,
      summary: cases.summary,
      first: clients.firstName,
      last: clients.lastName,
      email: clients.email,
    })
    .from(cases)
    .innerJoin(clients, eq(cases.clientId, clients.id))
    .where(eq(cases.ownerId, ownerId));
  const candidates: CaseCandidate[] = caseRows.map((c) => ({
    id: c.id,
    clientName: `${c.first} ${c.last}`,
    clientEmail: c.email ?? undefined,
    caseType: c.caseType,
    summary: c.aiSummary ?? c.summary ?? undefined,
  }));

  // Suggest a case per fresh item (best-effort; failures leave it blank).
  await Promise.all(
    fresh.map(async (m) => {
      try {
        const s = await suggestCaseForMessage(
          {
            fromName: m.fromName,
            fromAddress: m.fromAddress,
            subject: m.subject,
            snippet: m.snippet,
          },
          candidates,
        );
        await db
          .update(mailboxMessages)
          .set({ suggestedCaseId: s.caseId, suggestionReason: s.reason, updatedAt: new Date() })
          .where(and(eq(mailboxMessages.ownerId, ownerId), eq(mailboxMessages.externalId, m.id)));
      } catch {
        // leave suggestion empty
      }
    }),
  );

  return NextResponse.json({ added: fresh.length });
}
