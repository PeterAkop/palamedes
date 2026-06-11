import { and, asc, desc, eq } from 'drizzle-orm';
import type { CaseOption, TriageItem } from '@/data/cases';
import { cases, clients, db, mailboxMessages } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';

// Owner-scoped reads for the triage inbox.

export async function listPendingTriage(): Promise<TriageItem[]> {
  const ownerId = await getCurrentUserId();
  const rows = await db
    .select()
    .from(mailboxMessages)
    .where(and(eq(mailboxMessages.ownerId, ownerId), eq(mailboxMessages.status, 'pending')))
    .orderBy(desc(mailboxMessages.receivedAt));
  return rows.map((r) => ({
    id: r.id,
    fromName: r.fromName ?? undefined,
    fromAddress: r.fromAddress ?? undefined,
    subject: r.subject ?? '(no subject)',
    snippet: r.snippet ?? '',
    receivedAt: r.receivedAt?.toISOString(),
    conversationId: r.conversationId ?? undefined,
    suggestedCaseId: r.suggestedCaseId ?? undefined,
    suggestionReason: r.suggestionReason ?? undefined,
  }));
}

// All of the owner's cases as assignable options (dropdown + label lookup).
export async function listCaseOptions(): Promise<CaseOption[]> {
  const ownerId = await getCurrentUserId();
  const rows = await db
    .select({ id: cases.id, title: cases.title, surname: clients.lastName })
    .from(cases)
    .innerJoin(clients, eq(cases.clientId, clients.id))
    .where(eq(cases.ownerId, ownerId))
    .orderBy(asc(clients.lastName), asc(cases.title));
  return rows.map((r) => ({ id: r.id, label: `${r.surname} — ${r.title}` }));
}

export async function countPendingTriage(): Promise<number> {
  const ownerId = await getCurrentUserId();
  const rows = await db
    .select({ id: mailboxMessages.id })
    .from(mailboxMessages)
    .where(and(eq(mailboxMessages.ownerId, ownerId), eq(mailboxMessages.status, 'pending')));
  return rows.length;
}
