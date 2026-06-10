import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { cases, db } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';

// DELETE /api/cases/[id] — remove a case. Owner-scoped: the WHERE
// clause includes owner_id so a caller can't delete another owner's
// case. The FK cascades handle the rest — deleting a case removes its
// `sources` (and their `generation`s → `generation_messages`).
//
// TODO: like the source delete, this does not clean up the backing
// Vercel Blob objects / Anthropic Files API uploads for the case's
// file sources — they become orphaned. Acceptable for the POC.

export const runtime = 'nodejs';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = await getCurrentUserId();

  const deleted = await db
    .delete(cases)
    .where(and(eq(cases.id, params.id), eq(cases.ownerId, ownerId)))
    .returning({ id: cases.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: deleted[0].id });
}
