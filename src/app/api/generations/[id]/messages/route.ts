import type Anthropic from '@anthropic-ai/sdk';
import { and, asc, desc, eq } from 'drizzle-orm';
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

  // Build a BOUNDED context for the refine so input tokens stay flat
  // round-to-round instead of growing with every prior version:
  //   - message 0: the original case-context prompt (case summary +
  //     selected source summaries) — always the first user message.
  //   - the CURRENT draft: the latest assistant message (reflects any
  //     manual edit, since the edit route updates it in place).
  //   - the new refine instruction.
  // We deliberately drop the intermediate back-and-forth; the model
  // rewrites the full letter from the current draft + case facts. The
  // complete thread is still persisted below for the record.
  const [firstUser] = await db
    .select({ content: generationMessages.content })
    .from(generationMessages)
    .where(and(eq(generationMessages.generationId, gen.id), eq(generationMessages.role, 'user')))
    .orderBy(asc(generationMessages.createdAt))
    .limit(1);
  const [latestAssistant] = await db
    .select({ content: generationMessages.content })
    .from(generationMessages)
    .where(
      and(eq(generationMessages.generationId, gen.id), eq(generationMessages.role, 'assistant')),
    )
    .orderBy(desc(generationMessages.createdAt))
    .limit(1);

  const messages: Anthropic.MessageParam[] = [];
  if (firstUser) messages.push({ role: 'user', content: firstUser.content });
  if (latestAssistant) messages.push({ role: 'assistant', content: latestAssistant.content });
  messages.push({ role: 'user', content });

  // Persist the user turn + flip back to running before streaming.
  await db.insert(generationMessages).values({ generationId: gen.id, role: 'user', content });
  await db
    .update(generations)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(generations.id, gen.id));

  return streamGeneration({
    generationId: gen.id,
    system: tool.systemPrompt,
    messages,
  });
}
