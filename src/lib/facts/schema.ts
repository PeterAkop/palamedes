import { z } from 'zod';

// Zod schema for Pass-1 fact extraction. The extractor (src/lib/facts/
// extract.ts) forces Claude to emit an object of this exact shape via
// tool-use; we validate it here before persisting. Invalid extractions
// are never stored — see the deterministic-processing guidelines.
//
// One shared immigration schema across all source kinds (email,
// WhatsApp, note, file, scan). Structured facts (parties, dates,
// addresses, references, money) are objects; lighter facts
// (evidence_types, key_facts, action_items) are plain strings. Every
// array defaults to empty so a source with nothing to extract validates
// cleanly rather than erroring.

// Partial dates are allowed because immigration evidence is often
// month- or year-only: 'YYYY', 'YYYY-MM', or 'YYYY-MM-DD'.
export const partialDate = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'date must be YYYY, YYYY-MM, or YYYY-MM-DD');

export const confidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof confidenceSchema>;

export const partySchema = z.object({
  name: z.string().min(1),
  role: z.enum(['applicant', 'sponsor', 'child', 'official', 'representative', 'other']),
  confidence: confidenceSchema.optional(),
});

export const keyDateSchema = z.object({
  // Human label, e.g. "Relationship started", "Visa refused".
  label: z.string().min(1),
  date: partialDate,
  type: z.enum([
    'relationship_start',
    'cohabitation_start',
    'marriage',
    'birth',
    'application',
    'decision',
    'travel',
    'deadline',
    'other',
  ]),
  confidence: confidenceSchema.optional(),
});

export const addressSchema = z.object({
  value: z.string().min(1),
  type: z.enum(['current', 'previous', 'other']).default('current'),
  from: partialDate.optional(),
  to: partialDate.optional(),
  confidence: confidenceSchema.optional(),
});

export const referenceSchema = z.object({
  kind: z.enum([
    'home_office',
    'our_ref',
    'your_ref',
    'application_no',
    'NINO',
    'passport',
    'case_id',
    'other',
  ]),
  value: z.string().min(1),
  confidence: confidenceSchema.optional(),
});

export const moneySchema = z.object({
  // What the amount is, e.g. "gross annual income", "savings", "fee".
  label: z.string().min(1),
  amount: z.number(),
  currency: z.string().default('GBP'),
  // 'annual' | 'monthly' | 'one-off' | … — free text, optional.
  period: z.string().optional(),
  confidence: confidenceSchema.optional(),
});

export const prioritySchema = z.enum(['high', 'medium', 'low']);
export type Priority = z.infer<typeof prioritySchema>;

export const actionItemSchema = z.object({
  text: z.string().min(1),
  // How important this follow-up is: 'high' = blocks the application or is
  // legally required / time-critical; 'medium' = needed but not blocking;
  // 'low' = clarification / nice-to-have.
  priority: prioritySchema.optional(),
});
export type ActionItem = z.infer<typeof actionItemSchema>;

export const sourceFactsSchema = z.object({
  parties: z.array(partySchema).default([]),
  key_dates: z.array(keyDateSchema).default([]),
  addresses: z.array(addressSchema).default([]),
  references: z.array(referenceSchema).default([]),
  money: z.array(moneySchema).default([]),
  // Evidence the source provides or refers to, e.g. "joint tenancy
  // agreement", "council tax bill", "photos", "WhatsApp history".
  evidence_types: z.array(z.string().min(1)).default([]),
  // Atomic factual statements that don't fit the structured buckets.
  key_facts: z.array(z.string().min(1)).default([]),
  // Follow-ups / missing-evidence hints for the solicitor, each with a
  // priority so the lawyer can see what matters most at a glance.
  action_items: z.array(actionItemSchema).default([]),
  // For file/scan sources: what the document is (refusal letter,
  // payslip, marriage certificate, …). Omitted for text sources.
  document_type: z.string().min(1).optional(),
});

export type SourceFacts = z.infer<typeof sourceFactsSchema>;
export type Party = z.infer<typeof partySchema>;
export type KeyDate = z.infer<typeof keyDateSchema>;
export type Address = z.infer<typeof addressSchema>;
export type Reference = z.infer<typeof referenceSchema>;
export type Money = z.infer<typeof moneySchema>;
