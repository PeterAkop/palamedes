import type Anthropic from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import type { NewFact, Source } from '@/db/db';
import { db, facts as factsTable, sources } from '@/db/db';
import { anthropic, MODELS } from '@/lib/anthropic';
import { type SourceFacts, sourceFactsSchema } from '@/lib/facts/schema';

// Pass 1 — fact extraction. Convert one unstructured source into a
// validated `SourceFacts` object, then persist it as normalized rows in
// the `facts` table (the system of record). Deterministic by design:
//   - temperature 0
//   - output forced through a single tool (JSON-only, no prose)
//   - Zod-validated; invalid output is retried, never persisted
//
// This is the extraction half of the two-pass model. Generation (case
// summary, letters, …) reads the stored facts — never the raw source.

const FILES_BETA = 'files-api-2025-04-14';
const MAX_ATTEMPTS = 2;

const EXTRACT_SYSTEM_PROMPT = `You are a fact-extraction engine for a UK immigration law practice. You read one source from a case (an email, WhatsApp message, note, or document) and extract the concrete facts it contains into the structured tool schema.

Rules:
- Extract ONLY facts explicitly present in the source. Never infer, assume, or invent. If something is not stated, omit it.
- Prefer precise values: full names, exact dates, reference numbers, amounts.
- Dates may be partial — use 'YYYY-MM-DD' when a full date is given, 'YYYY-MM' or 'YYYY' when only the month or year is known.
- Set a per-fact confidence ('high' | 'medium' | 'low') reflecting how unambiguous the fact is in the source. Use 'low' when a value is implied or hard to read.
- Put atomic factual statements that don't fit a structured field into key_facts. Put follow-ups or missing-evidence observations into action_items.
- You MUST call the record_case_facts tool exactly once. Do not reply with prose. If the source contains no extractable facts, call the tool with empty arrays.`;

// JSON Schema for the tool. Mirrors sourceFactsSchema (src/lib/facts/
// schema.ts) — the descriptions here steer the model; the Zod schema is
// the authority that validates what comes back.
const confidenceProp = {
  type: 'string',
  enum: ['high', 'medium', 'low'],
  description: 'How unambiguous this fact is in the source.',
} as const;

const FACTS_TOOL = {
  name: 'record_case_facts',
  description:
    'Record the structured facts extracted from this source. Call exactly once. Only include facts explicitly present in the source.',
  input_schema: {
    type: 'object' as const,
    properties: {
      parties: {
        type: 'array',
        description: 'People named in the source and their role in the case.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            role: {
              type: 'string',
              enum: ['applicant', 'sponsor', 'child', 'official', 'representative', 'other'],
            },
            confidence: confidenceProp,
          },
          required: ['name', 'role'],
        },
      },
      key_dates: {
        type: 'array',
        description: 'Dated events relevant to the case.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Human label, e.g. "Relationship started".' },
            date: { type: 'string', description: "'YYYY', 'YYYY-MM', or 'YYYY-MM-DD'." },
            type: {
              type: 'string',
              enum: [
                'relationship_start',
                'cohabitation_start',
                'marriage',
                'birth',
                'application',
                'decision',
                'travel',
                'deadline',
                'other',
              ],
            },
            confidence: confidenceProp,
          },
          required: ['label', 'date', 'type'],
        },
      },
      addresses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            type: { type: 'string', enum: ['current', 'previous', 'other'] },
            from: { type: 'string', description: 'Lived-here-from date (partial allowed).' },
            to: { type: 'string', description: 'Lived-here-to date (partial allowed).' },
            confidence: confidenceProp,
          },
          required: ['value'],
        },
      },
      references: {
        type: 'array',
        description: 'Reference / case / document numbers.',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: [
                'home_office',
                'our_ref',
                'your_ref',
                'application_no',
                'NINO',
                'passport',
                'case_id',
                'other',
              ],
            },
            value: { type: 'string' },
            confidence: confidenceProp,
          },
          required: ['kind', 'value'],
        },
      },
      money: {
        type: 'array',
        description: 'Financial figures (income, savings, fees).',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'e.g. "gross annual income", "savings".' },
            amount: { type: 'number' },
            currency: { type: 'string', description: 'ISO code, default GBP.' },
            period: { type: 'string', description: "e.g. 'annual', 'monthly'." },
            confidence: confidenceProp,
          },
          required: ['label', 'amount'],
        },
      },
      evidence_types: {
        type: 'array',
        description:
          'Evidence the source provides or refers to, e.g. "joint tenancy agreement", "council tax bill", "photos".',
        items: { type: 'string' },
      },
      key_facts: {
        type: 'array',
        description: "Atomic factual statements that don't fit the structured fields.",
        items: { type: 'string' },
      },
      action_items: {
        type: 'array',
        description: 'Follow-ups or missing-evidence observations for the solicitor.',
        items: { type: 'string' },
      },
      document_type: {
        type: 'string',
        description:
          'For documents only: what the document is (e.g. "refusal letter", "payslip", "marriage certificate").',
      },
    },
    required: [],
  },
} as const;

// What to feed the extractor. Text sources pass their body; file/scan
// sources reference a previously-uploaded Anthropic Files API id.
export type ExtractInput =
  | {
      mode: 'text';
      kind: 'note' | 'email' | 'whatsapp';
      title: string;
      body: string;
      from?: string;
      subject?: string;
      fromPhone?: string;
    }
  | { mode: 'file'; title: string; mimeType: string; anthropicFileId: string };

export interface ExtractResult {
  facts: SourceFacts;
  model: string;
}

function buildUserContent(input: ExtractInput): Anthropic.Beta.BetaContentBlockParam[] {
  if (input.mode === 'file') {
    const isImage = input.mimeType.startsWith('image/');
    const fileBlock: Anthropic.Beta.BetaContentBlockParam = isImage
      ? { type: 'image', source: { type: 'file', file_id: input.anthropicFileId } }
      : {
          type: 'document',
          source: { type: 'file', file_id: input.anthropicFileId },
          title: input.title,
        };
    return [
      fileBlock,
      {
        type: 'text',
        text: `Document title set by the lawyer: ${input.title}. Extract its facts.`,
      },
    ];
  }

  const channel =
    input.kind === 'email' ? 'Email' : input.kind === 'whatsapp' ? 'WhatsApp message' : 'Note';
  const header = [`${channel} from a case.`, `Title: ${input.title}`];
  if (input.from) header.push(`From: ${input.from}`);
  if (input.subject) header.push(`Subject: ${input.subject}`);
  if (input.fromPhone) header.push(`From phone: ${input.fromPhone}`);
  return [{ type: 'text', text: `${header.join('\n')}\n\nContent:\n${input.body}` }];
}

// Run extraction. Forces the tool, validates with Zod, retries on an
// invalid/absent tool call. Throws if every attempt fails.
export async function extractSourceFacts(input: ExtractInput): Promise<ExtractResult> {
  const content = buildUserContent(input);
  const betas = input.mode === 'file' ? [FILES_BETA] : undefined;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await anthropic.beta.messages.create({
      model: MODELS.haiku,
      max_tokens: 1024,
      temperature: 0,
      system: EXTRACT_SYSTEM_PROMPT,
      tools: [FACTS_TOOL],
      tool_choice: { type: 'tool', name: FACTS_TOOL.name },
      messages: [{ role: 'user', content }],
      ...(betas ? { betas } : {}),
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock =>
        b.type === 'tool_use' && b.name === FACTS_TOOL.name,
    );
    if (!toolUse) {
      lastError = new Error('extractor did not call record_case_facts');
      continue;
    }

    const parsed = sourceFactsSchema.safeParse(toolUse.input);
    if (parsed.success) {
      return { facts: parsed.data, model: response.model };
    }
    // Invalid shape — never persist. Retry once more, then give up.
    lastError = new Error(`facts failed validation: ${parsed.error.message}`);
  }

  throw lastError ?? new Error('fact extraction failed');
}

// --- Persistence ----------------------------------------------------------

export interface SourceRef {
  id: string;
  caseId: string;
  ownerId: string;
}

// Flatten the structured object into one normalized row per atomic fact.
function sourceFactsToRows(source: SourceRef, f: SourceFacts): NewFact[] {
  const base = { caseId: source.caseId, sourceId: source.id, ownerId: source.ownerId };
  const rows: NewFact[] = [];

  for (const p of f.parties)
    rows.push({
      ...base,
      type: 'party',
      data: p,
      label: p.role,
      value: p.name,
      confidence: p.confidence,
    });
  for (const d of f.key_dates)
    rows.push({
      ...base,
      type: 'date',
      data: d,
      label: d.label,
      value: d.label,
      factDate: d.date,
      confidence: d.confidence,
    });
  for (const a of f.addresses)
    rows.push({
      ...base,
      type: 'address',
      data: a,
      label: a.type,
      value: a.value,
      factDate: a.from,
      confidence: a.confidence,
    });
  for (const r of f.references)
    rows.push({
      ...base,
      type: 'reference',
      data: r,
      label: r.kind,
      value: r.value,
      confidence: r.confidence,
    });
  for (const m of f.money)
    rows.push({
      ...base,
      type: 'money',
      data: m,
      label: m.label,
      value: `${m.amount} ${m.currency}`,
      confidence: m.confidence,
    });
  for (const e of f.evidence_types)
    rows.push({ ...base, type: 'evidence', data: { value: e }, value: e });
  for (const k of f.key_facts)
    rows.push({ ...base, type: 'key_fact', data: { text: k }, value: k });
  for (const ai of f.action_items)
    rows.push({ ...base, type: 'action_item', data: { text: ai }, value: ai });
  if (f.document_type)
    rows.push({
      ...base,
      type: 'document_type',
      data: { value: f.document_type },
      value: f.document_type,
    });

  return rows;
}

// Replace a source's facts (delete-then-insert) and stamp the source's
// extraction lifecycle. Idempotent: re-extracting replaces, never
// duplicates. (Neon HTTP has no interactive transaction; the small
// delete→insert window is acceptable for this single-writer flow.)
export async function persistSourceFacts(
  source: SourceRef,
  facts: SourceFacts,
  model: string,
): Promise<void> {
  const rows = sourceFactsToRows(source, facts);

  await db
    .delete(factsTable)
    .where(and(eq(factsTable.sourceId, source.id), eq(factsTable.ownerId, source.ownerId)));
  if (rows.length > 0) {
    await db.insert(factsTable).values(rows);
  }
  await db
    .update(sources)
    .set({ factsModel: model, factsExtractedAt: new Date(), updatedAt: new Date() })
    .where(eq(sources.id, source.id));
}

// Best-effort extract + persist for an ingestion path. Never throws —
// facts are an enrichment, so a failure here must not fail the source
// (which is still summarised and usable). Leaves facts_extracted_at null
// so a later retry can pick it up.
export async function extractAndStoreFacts(source: SourceRef, input: ExtractInput): Promise<void> {
  try {
    const { facts, model } = await extractSourceFacts(input);
    await persistSourceFacts(source, facts, model);
  } catch (err) {
    console.error('[facts extraction failed]', source.id, err);
  }
}

// Build an ExtractInput from a stored row — used by the retry path. Text
// kinds re-extract from the persisted full body (`raw_content`), falling
// back to `content_preview` for rows created before raw_content existed;
// file kinds re-extract at full fidelity via the stored Anthropic file
// id. Returns null when there's nothing usable to extract from (e.g. a
// file row missing its file id).
export function extractInputFromRow(row: Source): ExtractInput | null {
  const meta = (row.metadata ?? {}) as Record<string, string | undefined>;
  switch (row.kind) {
    case 'file':
    case 'scan':
      if (!row.anthropicFileId) return null;
      return {
        mode: 'file',
        title: row.title,
        mimeType: meta.mime_type ?? 'application/pdf',
        anthropicFileId: row.anthropicFileId,
      };
    case 'email':
    case 'whatsapp':
      return {
        mode: 'text',
        kind: row.kind,
        title: row.title,
        body: row.rawContent ?? row.contentPreview ?? '',
        from: meta.from,
        subject: meta.subject,
        fromPhone: meta.from_phone,
      };
    default:
      return {
        mode: 'text',
        kind: 'note',
        title: row.title,
        body: row.rawContent ?? row.contentPreview ?? '',
      };
  }
}
