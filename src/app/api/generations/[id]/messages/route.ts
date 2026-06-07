import type Anthropic from '@anthropic-ai/sdk';
import { and, asc, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, generationMessages, generations } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { getTool } from '@/lib/tools/registry';
import { streamGeneration } from '@/lib/tools/stream';

// POST /api/generations/[id]/messages — chat-on-generation. Appends a
// user refinement to an existing generation and re-streams Opus with
// the full prior thread, so the model revises in context. Same NDJSON
// stream shape as the generate route.

export const runtime = 'nodejs';

const BodySchema = z.object({
  content: z.string().min(1).max(4000),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = getCurrentUserId();

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { content } = parsed.data;

  const genRows = await db
    .select({ id: generations.id, toolId: generations.toolId })
    .from(generations)
    .where(and(eq(generations.id, params.id), eq(generations.ownerId, ownerId)))
    .limit(1);
  const gen = genRows[0];
  if (!gen) {
    return NextResponse.json({ error: 'generation_not_found' }, { status: 404 });
  }

  const tool = getTool(gen.toolId);
  if (!tool) {
    return NextResponse.json({ error: 'unknown_tool' }, { status: 400 });
  }

  // Reconstruct the conversation so far, then append the new turn.
  const priorRows = await db
    .select({ role: generationMessages.role, content: generationMessages.content })
    .from(generationMessages)
    .where(eq(generationMessages.generationId, gen.id))
    .orderBy(asc(generationMessages.createdAt));

  const history: Anthropic.MessageParam[] = priorRows.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));
  history.push({ role: 'user', content });

  // Persist the user turn + flip back to running before streaming.
  await db.insert(generationMessages).values({ generationId: gen.id, role: 'user', content });
  await db
    .update(generations)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(generations.id, gen.id));

  return streamGeneration({
    generationId: gen.id,
    system: tool.systemPrompt,
    messages: history,
  });
}
