import type Anthropic from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { cases, db, facts } from '@/db/db';
import { anthropic, MODELS } from '@/lib/anthropic';
import { taskMatchesEvidence } from '@/lib/facts/evidence';
import { reconcileCaseTasks } from '@/lib/tasks/queries';
import { TOOLS } from '@/lib/tools/registry';

// The action kinds the classifier may assign. `kind` drives the per-task
// action button; `suggestedToolId` (when a Tool performs the action) is the
// registry id that button launches.
const TASK_KINDS = [
  'request_documents',
  'draft_document',
  'collect_evidence',
  'review',
  'submit',
  'other',
] as const;

// Tool ids the classifier is allowed to suggest (so it can't invent one).
const TOOL_IDS = TOOLS.map((t) => t.id);

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
  kind: z.enum(TASK_KINDS).default('other'),
  // Optional — only meaningful when a Tool performs the action. Validated
  // against the registry below; an unknown id is dropped.
  suggestedToolId: z.string().optional(),
});
const actionPlanSchema = z.object({ items: z.array(planItemSchema) });

// A compact view of the Tools the classifier can route to.
const TOOL_MENU = TOOLS.map((t) => `- ${t.id} — ${t.label} (${t.category})`).join('\n');

const CONSOLIDATE_SYSTEM_PROMPT = `You are a UK immigration solicitor's case assistant. You are given the follow-up action items extracted from every source on a single case. Many are duplicates or near-duplicates phrased differently across sources. Produce one consolidated action plan:
- Merge items that mean the same thing into a single, clearly-phrased action.
- Keep genuinely distinct actions separate — never drop a unique task.
- Assign each item a priority: 'high' (blocks the application, legally required, or time-critical), 'medium' (needed but not blocking), 'low' (clarification or nice-to-have). When merging, use the highest priority of the merged items.
- Do not invent actions not implied by the input.

Classify each item with a "kind", and where a Tool performs the action, set "suggestedToolId" to the matching tool id (only an id from the list below):
- request_documents: ask the CLIENT to provide/upload documents. suggestedToolId: request-documents.
- draft_document: draft a letter, statement, email, or representation. Set suggestedToolId to the closest-matching tool from the list.
- collect_evidence: obtain or verify a specific piece of evidence yourself (not by asking the client). No tool.
- review: internally review, check, confirm, or assess something. No tool.
- submit: file or submit the application/appeal. No tool.
- other: anything that doesn't fit the above. No tool.

Available tools (id — label (category)):
${TOOL_MENU}

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
            kind: { type: 'string', enum: TASK_KINDS },
            suggestedToolId: {
              type: 'string',
              description: 'The id of the Tool that performs this action, if any (see the list).',
            },
          },
          required: ['text', 'priority', 'kind'],
        },
      },
    },
    required: ['items'],
  },
};

type ConsolidatedTask = {
  text: string;
  priority: string;
  kind: string;
  suggestedToolId: string | null;
};

// Regenerate and store the case's consolidated action plan. Loads the raw
// action_item facts, merges + classifies them via one Haiku call
// (temperature 0), and reconciles the result into case_tasks. No-op-safe:
// with no action items it reconciles an empty list (pruning stale AI tasks).
// Owner-scoped; `caseType` drives the evidence-overlap dedup.
export async function consolidateCaseActionItems(
  caseId: string,
  ownerId: string,
  caseType: string,
): Promise<void> {
  const rows = await db
    .select({ value: facts.value, priority: facts.label })
    .from(facts)
    .where(
      and(eq(facts.caseId, caseId), eq(facts.ownerId, ownerId), eq(facts.type, 'action_item')),
    );
  const items = rows
    .map((r) => ({ text: (r.value ?? '').trim(), priority: r.priority }))
    .filter((i) => i.text.length > 0);

  // No raw action items → an empty incoming list, which reconciliation uses
  // to prune any stale AI tasks (keeping manual / done / dismissed ones).
  let consolidated: ConsolidatedTask[] = [];

  if (items.length > 0) {
    const list = items
      .map((it, i) => `${i + 1}. [${it.priority ?? 'unset'}] ${it.text}`)
      .join('\n');

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
    consolidated = parsed.data.items
      // Drop "collect X" tasks the Evidence checklist already tracks, so the
      // have-list and do-list don't duplicate the same evidence.
      .filter((it) => !(it.kind === 'collect_evidence' && taskMatchesEvidence(caseType, it.text)))
      .map((it) => ({
        text: it.text,
        priority: it.priority,
        kind: it.kind,
        // Keep the suggested tool id only if it's a real one.
        suggestedToolId:
          it.suggestedToolId && TOOL_IDS.includes(it.suggestedToolId) ? it.suggestedToolId : null,
      }));
  }

  // Reconcile into the durable case_tasks store (preserves done/dismissed and
  // manual tasks across regenerations). The legacy action_plan_json column is
  // left untouched — case_tasks is the source of truth now.
  await reconcileCaseTasks(caseId, ownerId, consolidated);
  await db.update(cases).set({ actionPlanGeneratedAt: new Date() }).where(eq(cases.id, caseId));
}
