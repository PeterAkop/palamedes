import { and, desc, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, generationMessages, generations } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';

// POST /api/generations/[id]/edit — save a manual edit of the current
// draft. Updates the latest assistant message in place (rather than
// appending), so the edited text becomes "the draft" and any later
// refine uses it as context. Owner-scoped via the generation.

export const runtime = 'nodejs';

const BodySchema = z.object({ content: z.string().min(1).max(100_000) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = getCurrentUserId();

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const gen = await db
    .select({ id: generations.id })
    .from(generations)
    .where(and(eq(generations.id, params.id), eq(generations.ownerId, ownerId)))
    .limit(1);
  if (gen.length === 0) {
    return NextResponse.json({ error: 'generation_not_found' }, { status: 404 });
  }

  const latest = await db
    .select({ id: generationMessages.id })
    .from(generationMessages)
    .where(
      and(eq(generationMessages.generationId, params.id), eq(generationMessages.role, 'assistant')),
    )
    .orderBy(desc(generationMessages.createdAt))
    .limit(1);
  if (latest.length === 0) {
    return NextResponse.json({ error: 'no_draft_to_edit' }, { status: 409 });
  }

  await db
    .update(generationMessages)
    .set({ content: parsed.data.content })
    .where(eq(generationMessages.id, latest[0].id));
  await db.update(generations).set({ updatedAt: new Date() }).where(eq(generations.id, params.id));

  return NextResponse.json({ ok: true });
}
