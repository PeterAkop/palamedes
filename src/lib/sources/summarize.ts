import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODELS } from '@/lib/anthropic';

// Haiku-backed source summarizer. Server-only — called from API
// routes after a source row is inserted; the returned summary lands
// in the row's `ai_summary` + `ai_summary_model` columns.
//
// Slice 1 only handles `note` kind (plain text in, summary out). When
// files and pasted email/WhatsApp land in slices 2 and 3, this
// module grows new entry points (`summarizeFile`, `summarizeEmail`)
// that share the same client + system prompt skeleton.
//
// No streaming, no tool use, no prompt caching: the system prompt is
// well under Haiku's 4K cacheable minimum, so adding cache_control
// would silently no-op (the audit in shared/prompt-caching.md
// applies — short prefixes never cache). When the case-summary
// roll-up lands and the input grows past 4K, revisit.

const SYSTEM_PROMPT = `You are a senior UK immigration solicitor's case assistant. You receive raw notes, messages, and documents from a live case and summarise each one for the solicitor.

Write a concise summary (1–3 sentences, ≤80 words) capturing:
- The factual content — what was said, what's attached, what was decided.
- Any names, dates, references, document types, or amounts that are likely to matter for the case.
- Any open question or action the solicitor should follow up on.

Do not give legal advice. Do not speculate beyond what is in the note. If the note is vague, say so plainly. Output only the summary — no headers, no bullets, no preamble like "Summary:" or "This note...".`;

export interface SummarizeNoteInput {
  title: string;
  body: string;
}

export interface SummarizeResult {
  summary: string;
  model: string;
}

export async function summarizeNote(input: SummarizeNoteInput): Promise<SummarizeResult> {
  // Compose title + body into one user message — the title gives
  // Haiku what the lawyer chose to call the note (which is itself
  // signal about what to emphasise), the body is the content.
  const userText = `Note title: ${input.title}\n\nNote content:\n${input.body}`;

  const response = await anthropic.messages.create({
    model: MODELS.haiku,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
  });

  // Concatenate any text blocks (Haiku without tool use returns one,
  // but be defensive in case the API ever returns multiple).
  const summary = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (!summary) {
    throw new Error('Haiku returned an empty summary');
  }

  return { summary, model: response.model };
}
