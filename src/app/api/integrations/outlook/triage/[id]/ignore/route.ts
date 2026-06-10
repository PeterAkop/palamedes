import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { db, mailboxMessages } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';

// POST /api/integrations/outlook/triage/[id]/ignore — mark a triage item
// ignored so it drops off the list and won't resurface on re-sync.
// Owner-scoped.

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = getCurrentUserId();
  const updated = await db
    .update(mailboxMessages)
    .set({ status: 'ignored', updatedAt: new Date() })
    .where(and(eq(mailboxMessages.id, params.id), eq(mailboxMessages.ownerId, ownerId)))
    .returning({ id: mailboxMessages.id });
  if (updated.length === 0) {
    return NextResponse.json({ error: 'item_not_found' }, { status: 404 });
  }
  return NextResponse.json({ ignored: updated[0].id });
}
