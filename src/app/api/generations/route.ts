import { and, desc, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cases, db, generationMessages, generations } from '@/db/db';
import { MODELS } from '@/lib/anthropic';
import { getCurrentUserId } from '@/lib/auth';
import { getEvidenceChecklist } from '@/lib/facts/evidence';
import { buildToolContext } from '@/lib/tools/context';
import { buildRequestDocumentsEmail, getTool } from '@/lib/tools/registry';
import { streamGeneration, streamStaticContent } from '@/lib/tools/stream';
import { getOrCreateUploadLink } from '@/lib/upload/links';

// POST /api/generations — run a tool against a case. Inserts a
// generations row + the initial user message, then streams the Opus
// draft back as NDJSON (see streamGeneration). The assistant turn is
// persisted when the stream completes.

export const runtime = 'nodejs';

const BodySchema = z.object({
  caseId: z.string().uuid(),
  toolId: z.string().min(1),
  sourceIds: z.array(z.string().uuid()).optional(),
  instructions: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const ownerId = await getCurrentUserId();

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { caseId, toolId, sourceIds, instructions } = parsed.data;

  const tool = getTool(toolId);
  if (!tool) {
    return NextResponse.json({ error: 'unknown_tool' }, { status: 400 });
  }

  // Ownership check (also gates buildToolContext, which re-scopes).
  const caseRows = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.ownerId, ownerId)))
    .limit(1);
  if (caseRows.length === 0) {
    return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
  }

  const ctx = await buildToolContext(caseId, ownerId, sourceIds, instructions);
  if (!ctx) {
    return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
  }

  // Next per-(case, tool) version number.
  const prev = await db
    .select({ version: generations.version })
    .from(generations)
    .where(and(eq(generations.caseId, caseId), eq(generations.toolId, toolId)))
    .orderBy(desc(generations.version))
    .limit(1);
  const version = (prev[0]?.version ?? 0) + 1;

  const [gen] = await db
    .insert(generations)
    .values({ caseId, ownerId, toolId, version, status: 'running', model: MODELS.sonnet })
    .returning({ id: generations.id });

  // Template tools (e.g. Request Documents) build their content directly —
  // no Opus call. We mint the upload link + the missing-materials list and
  // stream the assembled email back.
  if (tool.template) {
    const token = await getOrCreateUploadLink(caseId, ownerId);
    const uploadUrl = `${req.nextUrl.origin}/upload/${token}`;
    const missing = (await getEvidenceChecklist(caseId, ownerId, ctx.caseType))
      .filter((e) => !e.present)
      .map((e) => e.label);
    const content = buildRequestDocumentsEmail({ ctx, uploadUrl, missing });
    await db.insert(generationMessages).values({
      generationId: gen.id,
      role: 'user',
      content: 'Generate the document-request email.',
    });
    return streamStaticContent({ generationId: gen.id, content });
  }

  if (!tool.systemPrompt || !tool.buildUserPrompt) {
    return NextResponse.json({ error: 'tool_not_runnable' }, { status: 400 });
  }
  const userPrompt = tool.buildUserPrompt(ctx);
  await db
    .insert(generationMessages)
    .values({ generationId: gen.id, role: 'user', content: userPrompt });

  return streamGeneration({
    generationId: gen.id,
    system: tool.systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
}
