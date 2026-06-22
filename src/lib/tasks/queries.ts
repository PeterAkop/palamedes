import { and, asc, eq } from 'drizzle-orm';
import type { CaseTaskView } from '@/data/cases';
import { type CaseTaskStatus, caseTasks, db } from '@/db/db';

// Case-tasks store (the Action plan). Tasks are seeded from the consolidated
// action_item facts but persist their own status, so checking one off
// survives a reanalyze. See schema.ts:caseTasks for the reconciliation model.

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

// Normalised identity for reconciliation/dedup: lowercase, collapse
// whitespace, drop trailing punctuation. Two phrasings that normalise to the
// same key are treated as the same task across regenerations.
export function normalizeTaskKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.;:,\s]+$/, '')
    .trim();
}

type Priority = 'high' | 'medium' | 'low';
function asPriority(p: string | null | undefined): Priority {
  return p === 'high' || p === 'low' ? p : 'medium';
}

// Reconcile the freshly-consolidated AI list against the stored tasks:
//   - upsert each incoming item by dedup_key (insert new as `open`; refresh
//     the text/priority of existing *open* AI tasks);
//   - prune AI tasks that are still `open` but no longer produced;
//   - never touch `manual` tasks or anything done/dismissed.
export async function reconcileCaseTasks(
  caseId: string,
  ownerId: string,
  incoming: Array<{ text: string; priority: string }>,
): Promise<void> {
  // Dedup the incoming list by key (the model can still emit near-dupes).
  const byKey = new Map<string, { text: string; priority: Priority }>();
  for (const it of incoming) {
    const text = it.text.trim();
    if (!text) continue;
    const key = normalizeTaskKey(text);
    if (!byKey.has(key)) byKey.set(key, { text, priority: asPriority(it.priority) });
  }

  const existing = await db
    .select()
    .from(caseTasks)
    .where(and(eq(caseTasks.caseId, caseId), eq(caseTasks.ownerId, ownerId)));
  const existingByKey = new Map(existing.map((t) => [t.dedupKey, t]));

  for (const [key, it] of byKey) {
    const ex = existingByKey.get(key);
    if (!ex) {
      await db
        .insert(caseTasks)
        .values({
          caseId,
          ownerId,
          text: it.text,
          priority: it.priority,
          dedupKey: key,
          origin: 'ai',
          status: 'open',
        })
        .onConflictDoNothing();
    } else if (ex.status === 'open' && ex.origin === 'ai') {
      // Refresh wording/priority without disturbing status.
      if (ex.text !== it.text || ex.priority !== it.priority) {
        await db
          .update(caseTasks)
          .set({ text: it.text, priority: it.priority, updatedAt: new Date() })
          .where(eq(caseTasks.id, ex.id));
      }
    }
  }

  // Prune AI tasks that vanished from the new list and were never acted on.
  for (const ex of existing) {
    if (ex.origin === 'ai' && ex.status === 'open' && !byKey.has(ex.dedupKey)) {
      await db.delete(caseTasks).where(eq(caseTasks.id, ex.id));
    }
  }
}

// All non-dismissed tasks for the case, as view-models: open first (by
// priority), then done. Dismissed tasks are hidden.
export async function getCaseTasks(caseId: string, ownerId: string): Promise<CaseTaskView[]> {
  const rows = await db
    .select()
    .from(caseTasks)
    .where(and(eq(caseTasks.caseId, caseId), eq(caseTasks.ownerId, ownerId)))
    .orderBy(asc(caseTasks.createdAt));

  return rows
    .filter((r) => r.status !== 'dismissed')
    .map((r) => ({
      id: r.id,
      text: r.text,
      priority: asPriority(r.priority),
      status: r.status === 'done' ? ('done' as const) : ('open' as const),
      kind: r.kind,
      suggestedToolId: r.suggestedToolId,
      origin: r.origin === 'manual' ? ('manual' as const) : ('ai' as const),
    }))
    .sort((a, b) => {
      // Open before done; within open, by priority.
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      return (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
    });
}

// Set a task's status (check off / reopen / dismiss). Owner-scoped; returns
// false if the task doesn't belong to this owner/case.
export async function setTaskStatus(
  caseId: string,
  ownerId: string,
  taskId: string,
  status: CaseTaskStatus,
): Promise<boolean> {
  const res = await db
    .update(caseTasks)
    .set({
      status,
      doneAt: status === 'done' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(caseTasks.id, taskId), eq(caseTasks.caseId, caseId), eq(caseTasks.ownerId, ownerId)),
    )
    .returning({ id: caseTasks.id });
  return res.length > 0;
}

// Add a lawyer-authored task. Idempotent on (case, dedup_key): adding a
// duplicate phrase returns the existing task instead of erroring.
export async function addManualTask(
  caseId: string,
  ownerId: string,
  text: string,
  priority: Priority = 'medium',
): Promise<CaseTaskView | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const dedupKey = normalizeTaskKey(trimmed);

  const [row] = await db
    .insert(caseTasks)
    .values({
      caseId,
      ownerId,
      text: trimmed,
      priority,
      dedupKey,
      origin: 'manual',
      status: 'open',
    })
    .onConflictDoUpdate({
      target: [caseTasks.caseId, caseTasks.dedupKey],
      // Re-open a previously dismissed/done task of the same wording.
      set: { status: 'open', doneAt: null, updatedAt: new Date() },
    })
    .returning();
  if (!row) return null;

  return {
    id: row.id,
    text: row.text,
    priority: asPriority(row.priority),
    status: row.status === 'done' ? 'done' : 'open',
    kind: row.kind,
    suggestedToolId: row.suggestedToolId,
    origin: row.origin === 'manual' ? 'manual' : 'ai',
  };
}
