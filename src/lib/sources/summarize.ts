import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODELS } from '@/lib/anthropic';

// Haiku-backed source summarizers. Server-only — called from API
// routes after a source row is inserted; the returned summary lands
// in the row's `ai_summary` + `ai_summary_model` columns.
//
// One entry point per source kind today:
//   - summarizeNote   — plain text (slice 1)
//   - summarizeFile   — files via the Anthropic Files API (slice 2)
//
// summarizePastedMessage (email / WhatsApp) lands with slice 3 and
// will share most of summarizeNote's plumbing — just a different
// system prompt that primes Claude for inbound-message context.
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
