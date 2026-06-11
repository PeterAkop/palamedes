import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { db, sources } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';

// DELETE /api/sources/[id] — remove a source from a case. Owner-scoped:
// the WHERE clause includes owner_id so a caller can't delete another
// owner's row even with a valid id.
//
// TODO: this does not yet clean up the backing Vercel Blob object or
// the Anthropic Files API upload for file/scan kinds — those become
// orphaned. Acceptable for the POC (the Blob URL is unguessable and
// gated by the fence); wire up best-effort cleanup when file volume
// matters.

export const runtime = 'nodejs';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = await getCurrentUserId();

  const deleted = await db
    .delete(sources)
    .where(and(eq(sources.id, params.id), eq(sources.ownerId, ownerId)))
    .returning({ id: sources.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'source_not_found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: deleted[0].id });
}
