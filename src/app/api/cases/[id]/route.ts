import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
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

// PATCH /api/cases/[id] — update editable case fields. Owner-scoped.
// Today: the matter references (our/your reference). Empty strings clear
// the field (stored as null). Extend the schema as more inline edits land.
const PatchSchema = z.object({
  ourReference: z.string().max(120).optional(),
  yourReference: z.string().max(120).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = await getCurrentUserId();

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // Empty string clears the field (null); a value is trimmed and stored.
  const norm = (v: string): string | null => (v.trim().length > 0 ? v.trim() : null);
  const updates: Record<string, string | null> = {};
  if (parsed.data.ourReference !== undefined) updates.ourReference = norm(parsed.data.ourReference);
  if (parsed.data.yourReference !== undefined)
    updates.yourReference = norm(parsed.data.yourReference);
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
  }

  const [updated] = await db
    .update(cases)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(cases.id, params.id), eq(cases.ownerId, ownerId)))
    .returning({ id: cases.id });

  if (!updated) {
    return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
  }
  return NextResponse.json({ updated: updated.id });
}

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
