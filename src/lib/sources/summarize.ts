import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODELS } from '@/lib/anthropic';

// Haiku-backed source summarizers. Server-only — called from API
// routes after a source row is inserted; the returned summary lands
// in the row's `ai_summary` + `ai_summary_model` columns.
//
// One entry point per source kind today:
//   - summarizeNote           — plain text (slice 1)
//   - summarizeFile           — files via the Anthropic Files API (slice 2)
//   - summarizePastedMessage  — pasted email / WhatsApp (slice 3)
//
// summarizePastedMessage shares summarizeNote's plumbing — a plain
// text-only Haiku call — but uses a system prompt that primes Claude
// for inbound-message context and threads the sender / subject /
// phone metadata into the prompt so the summary can reference it.
//
// Caching: not used today. The note prompts and file prompts are
// well under Haiku's 4K cacheable minimum, so `cache_control` would
// silently no-op. The case-summary roll-up (later slice) is where
// the input crosses the threshold and caching earns its keep.

// --- Notes ---------------------------------------------------------------

const NOTE_SYSTEM_PROMPT = `You are a senior UK immigration solicitor's case assistant. You receive raw notes, messages, and documents from a live case and summarise each one for the solicitor.

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
  const userText = `Note title: ${input.title}\n\nNote content:\n${input.body}`;

  const response = await anthropic.messages.create({
    model: MODELS.haiku,
    max_tokens: 256,
    system: NOTE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
  });

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

// --- Files ---------------------------------------------------------------

const FILE_SYSTEM_PROMPT = `You are a senior UK immigration solicitor's case assistant. You receive scanned documents, letters, payslips, and other files from a live case and summarise each one for the solicitor.

Write a concise summary (1–3 sentences, ≤80 words) capturing:
- What the document is (refusal letter, payslip, marriage certificate, passport scan, P60, etc.) and its date if visible.
- The key facts the solicitor needs: amounts, dates, names, reference numbers, decisions, amounts of leave to remain granted, etc.
- Anything the solicitor should flag or action.

Do not give legal advice. Do not speculate beyond what is in the file. If part of the file is illegible, say so plainly. Output only the summary — no headers, no bullets, no preamble like "Summary:" or "This document...".`;

export interface SummarizeFileInput {
  // Title set by the lawyer (defaults to filename if they don't
  // override). Passed to Claude as additional context so it knows
  // what the human called the file.
  title: string;
  // Mime type from the upload — drives whether we send the file as
  // an `image` block or a `document` block. PDFs and other docs go
  // as documents; JPEG/PNG/WebP go as images so Claude's vision
  // path handles them.
  mimeType: string;
  // The `file_id` returned by `anthropic.beta.files.upload(...)`.
  anthropicFileId: string;
}

export async function summarizeFile(input: SummarizeFileInput): Promise<SummarizeResult> {
  const isImage = input.mimeType.startsWith('image/');

  // The two block types take slightly different shapes — both
  // reference a previously-uploaded file by id rather than inlining
  // bytes (which keeps the request small even for big PDFs).
  const fileBlock: Anthropic.Beta.BetaContentBlockParam = isImage
    ? {
        type: 'image',
        source: { type: 'file', file_id: input.anthropicFileId },
      }
    : {
        type: 'document',
        source: { type: 'file', file_id: input.anthropicFileId },
        title: input.title,
      };

  const response = await anthropic.beta.messages.create({
    model: MODELS.haiku,
    max_tokens: 256,
    system: FILE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          fileBlock,
          {
            type: 'text',
            text: `File title set by the lawyer: ${input.title}. Summarise this file.`,
          },
        ],
      },
    ],
    betas: ['files-api-2025-04-14'],
  });

  const summary = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (!summary) {
    throw new Error('Haiku returned an empty file summary');
  }

  return { summary, model: response.model };
}

// --- Pasted messages (email / WhatsApp) ----------------------------------

const MESSAGE_SYSTEM_PROMPT = `You are a senior UK immigration solicitor's case assistant. You receive emails and WhatsApp messages pasted in from a live case and summarise each one for the solicitor.

Write a concise summary (1–3 sentences, ≤80 words) capturing:
- Who the message is from and what they are saying or asking.
- Any names, dates, references, deadlines, or facts that matter for the case.
- Any action or reply the solicitor needs to make.

Treat the message as correspondence — the sender may be the client, the Home Office, a third party, or an opponent. Do not give legal advice. Do not speculate beyond what is in the message. If the message is vague or truncated, say so plainly. Output only the summary — no headers, no bullets, no preamble like "Summary:" or "This message...".`;

export interface SummarizePastedMessageInput {
  // 'email' or 'whatsapp' — drives the header line we prepend so
  // Claude knows which kind of correspondence it's reading.
  kind: 'email' | 'whatsapp';
  title: string;
  body: string;
  // Optional correspondence metadata. `from` is the sender label for
  // both kinds (email address / contact name); `subject` is email-only;
  // `fromPhone` is WhatsApp-only. All are threaded into the prompt so
  // the summary can cite them.
  from?: string;
  subject?: string;
  fromPhone?: string;
}

export async function summarizePastedMessage(
  input: SummarizePastedMessageInput,
): Promise<SummarizeResult> {
  const channel = input.kind === 'email' ? 'Email' : 'WhatsApp message';
  const headerLines = [`${channel} pasted into the case.`, `Title: ${input.title}`];
  if (input.from) headerLines.push(`From: ${input.from}`);
  if (input.subject) headerLines.push(`Subject: ${input.subject}`);
  if (input.fromPhone) headerLines.push(`From phone: ${input.fromPhone}`);

  const userText = `${headerLines.join('\n')}\n\nContent:\n${input.body}`;

  const response = await anthropic.messages.create({
    model: MODELS.haiku,
    max_tokens: 256,
    system: MESSAGE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
  });

  const summary = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (!summary) {
    throw new Error('Haiku returned an empty message summary');
  }

  return { summary, model: response.model };
}

// --- Case roll-up --------------------------------------------------------

const CASE_SYSTEM_PROMPT = `You are a senior UK immigration solicitor's case assistant. You are given the individual AI summaries of every source on a single case (notes, emails, WhatsApp messages, documents). Synthesise them into one case-level summary the solicitor can read at a glance.

Write 3–6 sentences (≤180 words) that:
- State what the case is and where it stands overall.
- Pull together the key facts across sources: names, dates, references, financial figures, deadlines, decisions.
- Call out outstanding actions, missing evidence, or risks the solicitor should address next.

Do not give legal advice. Do not invent facts not present in the source summaries. If the sources conflict, note the conflict. Output only the summary prose — no headers, no bullets, no preamble like "Case summary:".`;

export interface CaseSourceForSummary {
  title: string;
  kind: string;
  aiSummary: string;
}

export interface SummarizeCaseInput {
  caseTitle: string;
  caseType: string;
  sources: CaseSourceForSummary[];
}

export async function summarizeCase(input: SummarizeCaseInput): Promise<SummarizeResult> {
  if (input.sources.length === 0) {
    throw new Error('Cannot summarise a case with no ready sources');
  }

  const sourceBlock = input.sources
    .map((s, i) => `${i + 1}. [${s.kind}] ${s.title}\n   ${s.aiSummary}`)
    .join('\n\n');

  const userText = `Case: ${input.caseTitle} (type: ${input.caseType})\n\nSource summaries:\n\n${sourceBlock}`;

  const response = await anthropic.messages.create({
    model: MODELS.haiku,
    max_tokens: 512,
    // The system prompt is the stable prefix; mark it cacheable. It
    // only actually caches once the rendered prefix crosses Haiku's
    // 4096-token minimum (large cases) — below that this silently
    // no-ops, which is fine.
    system: [{ type: 'text', text: CASE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userText }],
  });

  const summary = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (!summary) {
    throw new Error('Haiku returned an empty case summary');
  }

  return { summary, model: response.model };
}

// --- Case roll-up from structured facts (Pass 2) -------------------------

// Facts-driven case summary. This is the preferred path: it generates
// from the case Facts Store (deterministic, deduped — see
// src/lib/facts/case.ts) rather than from per-source prose, so identical
// facts produce a consistent summary. Temperature 0 for stability.

const CASE_FACTS_SYSTEM_PROMPT = `You are a senior UK immigration solicitor's case assistant. You are given the STRUCTURED FACTS extracted from every source on a single case — parties, key dates, references, addresses, financials, evidence, key facts, and outstanding action items. Synthesise them into one case-level summary the solicitor can read at a glance.

Write 3–6 sentences (≤180 words) that:
- State what the case is and where it stands overall.
- Pull together the key facts: parties, dates, references, financial figures, deadlines, decisions.
- Call out the outstanding actions, missing evidence, or risks the solicitor should address next.

Use ONLY the facts provided — do not invent or infer anything beyond them. If the facts are sparse, say so plainly rather than padding. If facts conflict, note the conflict. Output only the summary prose — no headers, no bullets, no preamble like "Case summary:".`;

export interface SummarizeCaseFromFactsInput {
  caseTitle: string;
  caseType: string;
  // Deterministic facts sheet from formatCaseFactsForPrompt(...).
  factsSheet: string;
}

export async function summarizeCaseFromFacts(
  input: SummarizeCaseFromFactsInput,
): Promise<SummarizeResult> {
  const userText = `Case: ${input.caseTitle} (type: ${input.caseType})\n\nExtracted facts:\n\n${input.factsSheet}`;

  const response = await anthropic.messages.create({
    model: MODELS.haiku,
    max_tokens: 512,
    temperature: 0,
    system: [
      { type: 'text', text: CASE_FACTS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userText }],
  });

  const summary = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (!summary) {
    throw new Error('Haiku returned an empty case summary');
  }

  return { summary, model: response.model };
}
