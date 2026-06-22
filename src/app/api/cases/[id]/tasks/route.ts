import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cases, db } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { addManualTask } from '@/lib/tasks/queries';

// POST /api/cases/[id]/tasks — add a lawyer-authored task to the Action plan.

export const runtime = 'nodejs';

const BodySchema = z.object({
  text: z.string().trim().min(1).max(500),
  priority: z.enum(['high', 'medium', 'low']).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = await getCurrentUserId();

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Ownership check — the task store is owner-scoped, but verify the case is
  // this owner's so we never attach a task to someone else's case id.
  const [own] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, params.id), eq(cases.ownerId, ownerId)))
    .limit(1);
  if (!own) {
    return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
  }

  const task = await addManualTask(params.id, ownerId, parsed.data.text, parsed.data.priority);
  if (!task) {
    return NextResponse.json({ error: 'empty_task' }, { status: 400 });
  }
  return NextResponse.json({ task });
}
