import type Anthropic from '@anthropic-ai/sdk';
import { eq, sql } from 'drizzle-orm';
import { db, generationMessages, generations } from '@/db/db';
import { anthropic, MODELS } from '@/lib/anthropic';

// Shared streaming helper for the Tools tab (Sonnet 4.6). Streams a draft (or
// a refinement) as NDJSON — one JSON object per line:
//   {"type":"start","generationId":"…"}  emitted first so the client
//                                         can drive the refine route
//   {"type":"delta","text":"…"}   incremental text
//   {"type":"done"}               persisted + generation marked complete
//   {"type":"error","message":""} generation marked failed
//
// On completion it persists the assistant turn as a generation_message
// and flips the generation row to complete/failed, so the server-
// component re-fetch after streaming shows the saved draft. Used by
// both the generate route and the refine route — the only difference
// between them is the `messages` history passed in.
//
// Sonnet 4.6 params: adaptive thinking + high effort, streamed (max_tokens
// well above the non-streaming timeout threshold). No temperature /
// budget_tokens on the 4.x family.

interface StreamArgs {
  generationId: string;
  system: string;
  messages: Anthropic.MessageParam[];
}

export function streamGeneration({ generationId, system, messages }: StreamArgs): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      let full = '';
      try {
        send({ type: 'start', generationId });
        const ms = anthropic.messages.stream({
          model: MODELS.sonnet,
          max_tokens: 64000,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'high' },
          system,
          messages,
        });

        for await (const event of ms) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            full += event.delta.text;
            send({ type: 'delta', text: event.delta.text });
          }
        }

        if (!full.trim()) throw new Error('The model returned an empty draft');

        // Token usage for this turn — accumulated onto the generation
        // row (this helper runs once per draft and once per refine).
        // Input counts cached tokens too where present.
        const usage = (await ms.finalMessage()).usage;
        const inputTokens =
          (usage.input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0);
        const outputTokens = usage.output_tokens ?? 0;

        await db
          .insert(generationMessages)
          .values({ generationId, role: 'assistant', content: full });
        await db
          .update(generations)
          .set({
            status: 'complete',
            inputTokens: sql`${generations.inputTokens} + ${inputTokens}`,
            outputTokens: sql`${generations.outputTokens} + ${outputTokens}`,
            updatedAt: new Date(),
          })
          .where(eq(generations.id, generationId));

        send({ type: 'done' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        await db
          .update(generations)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(generations.id, generationId))
          .catch(() => {});
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// Like streamGeneration but for template tools: emit pre-built content as a
// single delta (so the client's NDJSON consumer is unchanged), persist it,
// and mark the generation complete. No LLM call.
export function streamStaticContent({
  generationId,
  content,
}: {
  generationId: string;
  content: string;
}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        send({ type: 'start', generationId });
        send({ type: 'delta', text: content });
        await db.insert(generationMessages).values({ generationId, role: 'assistant', content });
        await db
          .update(generations)
          .set({ status: 'complete', updatedAt: new Date() })
          .where(eq(generations.id, generationId));
        send({ type: 'done' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        await db
          .update(generations)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(generations.id, generationId))
          .catch(() => {});
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
