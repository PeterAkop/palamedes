import { and, eq, ne } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cases, db, mailboxMessages } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { getMessageById } from '@/lib/outlook/graph';
import { getValidAccessToken } from '@/lib/outlook/tokens';
import { createEmailSourceFromOutlook } from '@/lib/sources/fromEmail';

// POST /api/integrations/outlook/triage/[id]/assign — assign a triage
// item to a case: fetch the full message, create an `email` source on the
// case, mark the item assigned. With `includeThread`, do the same for the
// other pending items sharing its conversation. Owner-scoped.

export const runtime = 'nodejs';

const BodySchema = z.object({
  caseId: z.string().uuid(),
  includeThread: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = await getCurrentUserId();

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { caseId, includeThread } = parsed.data;

  // The triage item.
  const [item] = await db
    .select()
    .from(mailboxMessages)
    .where(and(eq(mailboxMessages.id, params.id), eq(mailboxMessages.ownerId, ownerId)))
    .limit(1);
  if (!item) return NextResponse.json({ error: 'item_not_found' }, { status: 404 });

  // The target case (ownership check).
  const [caseRow] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.ownerId, ownerId)))
    .limit(1);
  if (!caseRow) return NextResponse.json({ error: 'case_not_found' }, { status: 404 });

  let token: string;
  try {
    token = await getValidAccessToken(ownerId, 'outlook');
  } catch {
    return NextResponse.json({ error: 'outlook_not_connected' }, { status: 409 });
  }

  // Build the list of items to assign: this one, plus same-conversation
  // pending siblings if requested.
  const targets = [item];
  if (includeThread && item.conversationId) {
    const siblings = await db
      .select()
      .from(mailboxMessages)
      .where(
        and(
          eq(mailboxMessages.ownerId, ownerId),
          eq(mailboxMessages.conversationId, item.conversationId),
          eq(mailboxMessages.status, 'pending'),
          ne(mailboxMessages.id, item.id),
        ),
      );
    targets.push(...siblings);
  }

  let assigned = 0; // triage items resolved
  let created = 0; // new sources actually added
  for (const t of targets) {
    try {
      const message = await getMessageById(token, t.externalId);
      // Idempotent: returns false if the email is already a source on the
      // case (no duplicate). The item is still marked assigned — it's
      // resolved either way, just not duplicated.
      const wasCreated = await createEmailSourceFromOutlook({ caseId, ownerId, message });
      await db
        .update(mailboxMessages)
        .set({ status: 'assigned', assignedCaseId: caseId, updatedAt: new Date() })
        .where(eq(mailboxMessages.id, t.id));
      assigned += 1;
      if (wasCreated) created += 1;
    } catch {
      // skip this one; continue with the rest of the thread
    }
  }

  if (assigned === 0) {
    return NextResponse.json({ error: 'assign_failed' }, { status: 502 });
  }
  return NextResponse.json({ assigned, created, alreadyPresent: assigned - created });
}
