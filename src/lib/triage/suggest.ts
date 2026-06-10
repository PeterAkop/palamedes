import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODELS } from '@/lib/anthropic';

// Haiku-backed case suggestion for a triage message. Given one email and
// the owner's cases, it picks the single best-matching case id — or null
// when nothing is a confident match (it must not guess). Forced tool call
// for a clean structured result. Suggestion only; the lawyer confirms.

export interface CaseCandidate {
  id: string;
  clientName: string;
  clientEmail?: string;
  caseType: string;
  summary?: string;
}

export interface MessageForSuggestion {
  fromName?: string;
  fromAddress?: string;
  subject: string;
  snippet: string;
}

export interface Suggestion {
  caseId: string | null;
  reason: string;
}

const SYSTEM_PROMPT = `You are a UK immigration law firm's case assistant. You are given one email from the solicitor's mailbox and a list of the firm's cases. Decide which single case the email most likely belongs to, or that none is a confident match.

Weigh: the sender/recipient address matching a client's email; the client's name, the Home Office reference, or case-specific facts appearing in the subject or preview; and topical fit. If nothing is a confident match, return "none" — do not guess. Respond only via the tool.`;

const TOOL: Anthropic.Tool = {
  name: 'record_suggestion',
  description: 'Record the best-matching case for this email.',
  input_schema: {
    type: 'object',
    properties: {
      caseId: {
        type: 'string',
        description:
          'The id of the best-matching case from the provided list, or the literal "none".',
      },
      reason: {
        type: 'string',
        description: 'One short sentence (≤20 words) explaining the choice.',
      },
    },
    required: ['caseId', 'reason'],
  },
};

export async function suggestCaseForMessage(
  message: MessageForSuggestion,
  candidates: CaseCandidate[],
): Promise<Suggestion> {
  if (candidates.length === 0) return { caseId: null, reason: 'No cases to match against.' };

  const caseList = candidates
    .map(
      (c) =>
        `- id=${c.id} | ${c.clientName}${c.clientEmail ? ` <${c.clientEmail}>` : ''} | ${c.caseType}${c.summary ? ` | ${c.summary.slice(0, 200)}` : ''}`,
    )
    .join('\n');

  const userText = `Email:\nFrom: ${message.fromName ?? ''} <${message.fromAddress ?? ''}>\nSubject: ${message.subject}\nPreview: ${message.snippet}\n\nCases:\n${caseList}`;

  const res = await anthropic.messages.create({
    model: MODELS.haiku,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'record_suggestion' },
    messages: [{ role: 'user', content: userText }],
  });

  const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const input = (toolUse?.input ?? {}) as { caseId?: string; reason?: string };
  const valid = Boolean(
    input.caseId && input.caseId !== 'none' && candidates.some((c) => c.id === input.caseId),
  );
  return { caseId: valid ? (input.caseId as string) : null, reason: input.reason ?? '' };
}
