import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUserId } from '@/lib/auth';
import { setTaskStatus } from '@/lib/tasks/queries';

// PATCH /api/cases/[id]/tasks/[taskId] — update a task's status:
// check off (done), reopen (open), or dismiss.

export const runtime = 'nodejs';

const BodySchema = z.object({
  status: z.enum(['open', 'done', 'dismissed']),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; taskId: string } },
) {
  const ownerId = await getCurrentUserId();

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const ok = await setTaskStatus(params.id, ownerId, params.taskId, parsed.data.status);
  if (!ok) {
    return NextResponse.json({ error: 'task_not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
