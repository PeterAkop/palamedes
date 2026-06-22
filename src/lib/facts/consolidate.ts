import type Anthropic from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ActionPlanItem } from '@/data/cases';
import { cases, db, facts } from '@/db/db';
import { anthropic, MODELS } from '@/lib/anthropic';

// Pass 2 — action-item consolidation. The per-source extraction produces
// many overlapping action items ("Confirm which evidence to include" vs
// "Clarify which evidence items should be included"), phrased differently
// across sources. Token-overlap dedup can't tell those mean the same
// thing, so we run one LLM pass that merges true duplicates into a single
// clean, prioritised action plan and stores it on the case. Regenerated
// alongside the case summary; the Facts tab reads the stored plan.

const planItemSchema = z.object({
  text: z.string().min(1),
  priority: z.enum(['high', 'medium', 'low']),
});
const actionPlanSchema = z.object({ items: z.array(planItemSchema) });

const CONSOLIDATE_SYSTEM_PROMPT = `You are a UK immigration solicitor's case assistant. You are given the follow-up action items extracted from every source on a single case. Many are duplicates or near-duplicates phrased differently across sources. Produce one consolidated action plan:
- Merge items that mean the same thing into a single, clearly-phrased action.
- Keep genuinely distinct actions separate — never drop a unique task.
- Assign each item a priority: 'high' (blocks the application, legally required, or time-critical), 'medium' (needed but not blocking), 'low' (clarification or nice-to-have). When merging, use the highest priority of the merged items.
- Do not invent actions not implied by the input.
You MUST call record_action_plan exactly once.`;

const CONSOLIDATE_TOOL = {
  name: 'record_action_plan',
  description: 'Record the consolidated, de-duplicated, prioritised action plan for the case.',
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'One clear, actionable follow-up.' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['text', 'priority'],
        },
      },
    },
    required: ['items'],
  },
};

// Regenerate and store the case's consolidated action plan. Loads the raw
// action_item facts, merges them via one Haiku call (temperature 0), and
// writes the result to cases.action_plan_json. No-op-safe: with no action
// items it stores an empty plan. Owner-scoped.
export async function consolidateCaseActionItems(caseId: string, ownerId: string): Promise<void> {
  const rows = await db
    .select({ value: facts.value, priority: facts.label })
    .from(facts)
    .where(
      and(eq(facts.caseId, caseId), eq(facts.ownerId, ownerId), eq(facts.type, 'action_item')),
    );
  const items = rows
    .map((r) => ({ text: (r.value ?? '').trim(), priority: r.priority }))
    .filter((i) => i.text.length > 0);

  if (items.length === 0) {
    await db
      .update(cases)
      .set({ actionPlanJson: [], actionPlanGeneratedAt: new Date(), updatedAt: new Date() })
      .where(eq(cases.id, caseId));
    return;
  }

  const list = items.map((it, i) => `${i + 1}. [${it.priority ?? 'unset'}] ${it.text}`).join('\n');

  const response = await anthropic.messages.create({
    model: MODELS.haiku,
    max_tokens: 2048,
    temperature: 0,
    system: CONSOLIDATE_SYSTEM_PROMPT,
    tools: [CONSOLIDATE_TOOL],
    tool_choice: { type: 'tool', name: CONSOLIDATE_TOOL.name },
    messages: [{ role: 'user', content: `Action items extracted from this case:\n\n${list}` }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === CONSOLIDATE_TOOL.name,
  );
  const parsed = toolUse ? actionPlanSchema.safeParse(toolUse.input) : null;
  if (!parsed?.success) {
    throw new Error('action-plan consolidation returned no valid plan');
  }

  await db
    .update(cases)
    .set({
      actionPlanJson: parsed.data.items,
      actionPlanGeneratedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(cases.id, caseId));
}

// Read the stored consolidated action plan for the case (owner-scoped).
// Returns [] when none has been generated yet.
export async function getCaseActionPlan(
  caseId: string,
  ownerId: string,
): Promise<ActionPlanItem[]> {
  const [row] = await db
    .select({ plan: cases.actionPlanJson })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.ownerId, ownerId)))
    .limit(1);
  const plan = row?.plan;
  if (!Array.isArray(plan)) return [];
  return plan
    .filter(
      (p): p is { text: string; priority?: string } => Boolean(p) && typeof p.text === 'string',
    )
    .map((p) => ({
      text: p.text,
      priority: typeof p.priority === 'string' ? p.priority : undefined,
    }));
}
