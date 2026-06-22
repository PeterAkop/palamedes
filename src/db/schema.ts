import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Palamedes DB schema.
//
// `owner_id` on every table is `text` (not uuid) so it can hold any
// future auth provider's user id without a column-type migration —
// Supabase Auth issues UUIDs, Clerk/Auth.js issue strings like
// `user_2abc…`. Today every row carries the fence constant from
// `getCurrentUserId()` in src/lib/auth.ts (Phase A.1 single-tester
// POC behind the HTTP Basic fence).
//
// Tables: clients, cases, sources, generations, generation_messages.

// --- Clients --------------------------------------------------------------

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    dateOfBirth: date('date_of_birth'),
    nationality: text('nationality'),
    preferredLanguage: text('preferred_language'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('clients_owner_id_idx').on(t.ownerId)],
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;

// --- Cases ----------------------------------------------------------------

// CASE_TYPES / CASE_STATUSES exported as const tuples so the labels
// module (`lib/cases/labels.ts`) and any Zod validators can derive the
// allowed values without drift.

export const CASE_TYPES = [
  'spouse-visa',
  'family-visa',
  'ilr',
  'naturalisation',
  'work-visa',
  'study-visa',
  'eu-settlement',
  'extension',
  'appeal',
  'asylum',
  'sponsorship',
  'other',
] as const;

export const CASE_STATUSES = [
  'open',
  'in_progress',
  'submitted',
  'granted',
  'refused',
  'on_hold',
  'closed',
] as const;

export type CaseType = (typeof CASE_TYPES)[number];
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const cases = pgTable(
  'cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull(),
    title: text('title').notNull(),
    caseType: text('case_type').notNull(),
    status: text('status').notNull().default('open'),
    homeOfficeReference: text('home_office_reference'),
    // The firm's matter reference ("our reference") and the recipient's
    // ("your reference") for letterheads. Lawyer-set; when absent the
    // drafting tools placeholder them rather than inventing a number.
    ourReference: text('our_reference'),
    yourReference: text('your_reference'),
    deadline: date('deadline'),
    // Manually-authored case description from the lawyer.
    summary: text('summary'),
    // AI-generated *case summary* — rolled up across the case's source
    // summaries by Haiku (POST /api/cases/[id]/summary). Kept separate
    // from the lawyer-authored `summary` so neither overwrites the
    // other. `ai_summary_generated_at` lets the UI show when it was
    // last refreshed; `ai_summary_model` records which model produced it.
    aiSummary: text('ai_summary'),
    aiSummaryModel: text('ai_summary_model'),
    aiSummaryGeneratedAt: timestamp('ai_summary_generated_at', { withTimezone: true }),
    // Consolidated action plan — an LLM merges the per-source action_item
    // facts into one deduplicated, prioritised list (Pass 2). jsonb array
    // of { text, priority }. Regenerated alongside the case summary.
    actionPlanJson: jsonb('action_plan_json').$type<Array<{ text: string; priority?: string }>>(),
    actionPlanGeneratedAt: timestamp('action_plan_generated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cases_client_id_idx').on(t.clientId),
    index('cases_owner_id_idx').on(t.ownerId),
    check(
      'cases_case_type_check',
      sql`${t.caseType} IN ('spouse-visa','family-visa','ilr','naturalisation','work-visa','study-visa','eu-settlement','extension','appeal','asylum','sponsorship','other')`,
    ),
    check(
      'cases_status_check',
      sql`${t.status} IN ('open','in_progress','submitted','granted','refused','on_hold','closed')`,
    ),
  ],
);

export type Case = typeof cases.$inferSelect;
export type NewCase = typeof cases.$inferInsert;

// --- Sources --------------------------------------------------------------

// SOURCE_KINDS / SOURCE_STATUSES exported as const tuples so the
// labels module and Zod validators derive allowed values from the
// same place as the DB CHECK constraint.

export const SOURCE_KINDS = ['whatsapp', 'email', 'file', 'note', 'scan'] as const;

// `queued` is the initial state for sources created without inline
// processing (future: WhatsApp/Outlook webhooks). Today's manual
// ingestion paths (note, paste, upload) flip to `processing`
// immediately and to `ready` once Haiku returns. `failed` carries an
// `error_message` for the lawyer to triage.
export const SOURCE_STATUSES = ['queued', 'processing', 'ready', 'failed'] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull(),

    // What kind of source this is + a human-readable title that
    // shows in the Sources list.
    kind: text('kind').notNull(),
    title: text('title').notNull(),

    // Extracted preview for the collapsed source row card — for
    // notes / pasted content this is usually the leading chars; for
    // files it stays null (the file is the content).
    contentPreview: text('content_preview'),

    // Full original text for text sources (note / email / whatsapp), so
    // re-summarisation and re-extraction run at full fidelity instead of
    // from the truncated content_preview. Null for file/scan kinds — they
    // keep their bytes in Blob (blob_path) / the Anthropic Files API.
    rawContent: text('raw_content'),

    // When the source itself was received (email date, WhatsApp
    // message timestamp, file mod time). Distinct from created_at
    // which is when it landed in Palamedes.
    sourceReceivedAt: timestamp('source_received_at', { withTimezone: true }),

    // Kind-specific fields — email `from`/`subject`, WhatsApp
    // `from_phone`, file `mime_type`/`size_bytes`, etc. Loose schema
    // by design; renderers narrow as needed.
    metadata: jsonb('metadata').$type<Record<string, string | undefined>>(),

    // Async processing lifecycle. `error_message` populates only
    // when status='failed' (Haiku/Anthropic API errors, OCR failures
    // later, etc.).
    status: text('status').notNull().default('queued'),
    errorMessage: text('error_message'),

    // Haiku output. `ai_summary_model` lets us know which model
    // generated it (`claude-haiku-4-5` today) so we can re-summarize
    // selectively when models change.
    aiSummary: text('ai_summary'),
    aiSummaryModel: text('ai_summary_model'),

    // Pass-1 structured fact extraction lifecycle (separate from the
    // prose summary above; the facts themselves live in the `facts`
    // table). `facts_extracted_at` null = not yet extracted or the last
    // attempt failed; `facts_model` records the extractor model.
    factsModel: text('facts_model'),
    factsExtractedAt: timestamp('facts_extracted_at', { withTimezone: true }),

    // Storage references — populate only for file/scan kinds.
    // `blob_path` is the Vercel Blob URL (private); `anthropic_file_id`
    // is what we pass to the Anthropic Files API for Claude inputs.
    blobPath: text('blob_path'),
    anthropicFileId: text('anthropic_file_id'),

    // External source id for integration-pulled sources (e.g. the
    // Microsoft Graph message id). Lets the Outlook pull dedupe so
    // re-pulling a case doesn't create duplicate `email` rows. Null
    // for manually-added sources.
    externalId: text('external_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sources_case_id_idx').on(t.caseId),
    index('sources_owner_id_idx').on(t.ownerId),
    // Status index is for future background-job queries
    // ("find all 'queued' sources to process"). Cheap to add now;
    // a no-op until we add a queue worker.
    index('sources_status_idx').on(t.status),
    // Dedup lookups on pull: "does this case already have this external id?"
    index('sources_case_external_idx').on(t.caseId, t.externalId),
    check('sources_kind_check', sql`${t.kind} IN ('whatsapp','email','file','note','scan')`),
    check('sources_status_check', sql`${t.status} IN ('queued','processing','ready','failed')`),
  ],
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

// --- Facts (structured extraction / system of record) ---------------------

// Normalized fact rows extracted from sources in Pass 1. The Facts Store
// is the system of record: downstream generation (case summary, letters,
// missing-evidence, timeline) reads FACTS — not raw documents or prose
// summaries — so identical inputs yield consistent outputs.
//
// One row per atomic fact. `type` discriminates; `data` holds the typed
// payload (validated by the Zod schema in src/lib/facts/schema.ts before
// insert — invalid extractions are never persisted). `label` / `value` /
// `fact_date` are denormalized out of `data` for cheap querying, dedup,
// and timeline ordering without unpacking the jsonb. Every row keeps its
// `source_id` provenance so any case fact traces back to a document.
//
// Idempotency: extraction is delete-then-insert per source, so
// re-extracting a source replaces its facts rather than duplicating.

export const FACT_TYPES = [
  'party',
  'date',
  'address',
  'reference',
  'money',
  'evidence',
  'key_fact',
  'action_item',
  'document_type',
] as const;
export type FactType = (typeof FACT_TYPES)[number];

export const facts = pgTable(
  'facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull(),

    // Discriminator + typed payload (Zod-validated before insert).
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),

    // Denormalized from `data` for querying without unpacking jsonb:
    // a short human label, the canonical string value, and (date facts)
    // an ISO or partial (`YYYY-MM`) date string for timeline ordering.
    label: text('label'),
    value: text('value'),
    factDate: text('fact_date'),

    // Extractor's self-reported confidence ('high' | 'medium' | 'low'),
    // when available — lets generation prefer high-confidence facts.
    confidence: text('confidence'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('facts_case_id_idx').on(t.caseId),
    index('facts_source_id_idx').on(t.sourceId),
    index('facts_owner_id_idx').on(t.ownerId),
    index('facts_case_type_idx').on(t.caseId, t.type),
    check(
      'facts_type_check',
      sql`${t.type} IN ('party','date','address','reference','money','evidence','key_fact','action_item','document_type')`,
    ),
  ],
);

export type Fact = typeof facts.$inferSelect;
export type NewFact = typeof facts.$inferInsert;

// --- Generations ----------------------------------------------------------

// A `generation` is one run of a Tool (e.g. "Cover Letter — Spouse
// Visa") against a case: Opus drafts a document from the case summary +
// selected sources. `generation_messages` is the chat-on-generation
// thread — the initial draft request, the assistant's draft, and any
// refinement turns.

export const GENERATION_STATUSES = ['running', 'complete', 'failed'] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const GENERATION_ROLES = ['user', 'assistant'] as const;
export type GenerationRole = (typeof GENERATION_ROLES)[number];

export const generations = pgTable(
  'generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull(),

    // Which tool produced this run — matches an id in the in-code tool
    // registry (src/lib/tools/registry.ts), not a DB-enforced enum, so
    // the registry can evolve without a migration.
    toolId: text('tool_id').notNull(),
    // Per-(case, tool) run number, surfaced as "v1", "v2" in the UI.
    version: integer('version').notNull().default(1),
    status: text('status').notNull().default('running'),
    // The model that produced the draft (e.g. claude-opus-4-8).
    model: text('model').notNull(),

    // Token usage for this run, accumulated across the initial draft and
    // every refine turn (both go through streamGeneration). Lets us
    // report spend per tool/date. Input includes any cache tokens.
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),

    // Send record — populated when the draft is emailed out (Graph
    // /me/sendMail). `sent_at` null means never sent. `sent_to` is the
    // actual recipient used; `sent_to_client` distinguishes a real
    // client send (feature flag on) from the safe lawyer-mailbox send
    // (flag off, the default). A re-send overwrites these with the
    // latest send.
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentTo: text('sent_to'),
    sentToClient: boolean('sent_to_client').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('generations_case_id_idx').on(t.caseId),
    index('generations_owner_id_idx').on(t.ownerId),
    check('generations_status_check', sql`${t.status} IN ('running','complete','failed')`),
  ],
);

export type Generation = typeof generations.$inferSelect;
export type NewGeneration = typeof generations.$inferInsert;

export const generationMessages = pgTable(
  'generation_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    generationId: uuid('generation_id')
      .notNull()
      .references(() => generations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('generation_messages_generation_id_idx').on(t.generationId),
    check('generation_messages_role_check', sql`${t.role} IN ('user','assistant')`),
  ],
);

export type GenerationMessage = typeof generationMessages.$inferSelect;
export type NewGenerationMessage = typeof generationMessages.$inferInsert;

// --- Integration tokens ---------------------------------------------------

// OAuth tokens for external integrations the lawyer connects (Outlook
// first). One row per (owner, provider). `access_token` / `refresh_token`
// are stored ENCRYPTED at rest (AES-GCM via MS_TOKEN_ENC_KEY) — see
// src/lib/outlook/tokens.ts; the DB only ever holds ciphertext.
// `account_email` is the connected mailbox (shown in the UI). For the
// single fence user there's just one Outlook row today.

export const INTEGRATION_PROVIDERS = ['outlook'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const integrationTokens = pgTable(
  'integration_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id').notNull(),
    provider: text('provider').notNull(),
    // Encrypted at rest. Refresh token may be absent if the provider
    // didn't return one (we request offline_access so it should).
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    scope: text('scope'),
    accountEmail: text('account_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One connection per (owner, provider) — upsert target.
    uniqueIndex('integration_tokens_owner_provider_idx').on(t.ownerId, t.provider),
    check('integration_tokens_provider_check', sql`${t.provider} IN ('outlook')`),
  ],
);

export type IntegrationToken = typeof integrationTokens.$inferSelect;
export type NewIntegrationToken = typeof integrationTokens.$inferInsert;

// --- Firm details ---------------------------------------------------------

// Per-user firm letterhead / identity. One row per owner (the lawyer's
// firm). These are the fixed details that prefill every client-facing
// generated letter — name, address, regulatory info, signatory — edited
// once in Settings rather than retyped per draft. All columns nullable
// so a user can fill them in incrementally; the row is upserted.
export const firmSettings = pgTable(
  'firm_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id').notNull(),
    // Firm identity / letterhead.
    firmName: text('firm_name'),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    sraNumber: text('sra_number'),
    vatNumber: text('vat_number'),
    // Blob path of the uploaded firm logo (rendered on formatted output).
    logoBlobPath: text('logo_blob_path'),
    // Signatory / fee earner.
    signatoryName: text('signatory_name'),
    signatoryTitle: text('signatory_title'),
    signatoryEmail: text('signatory_email'),
    assistingFeeEarner: text('assisting_fee_earner'),
    // Letter scaffolding + boilerplate.
    referencePrefix: text('reference_prefix'),
    complaintsFooter: text('complaints_footer'),
    bankDetails: text('bank_details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One firm row per owner — the upsert target.
    uniqueIndex('firm_settings_owner_idx').on(t.ownerId),
  ],
);

export type FirmSettings = typeof firmSettings.$inferSelect;
export type NewFirmSettings = typeof firmSettings.$inferInsert;

// --- Client upload links --------------------------------------------------

// Tokenised links that let a client upload files to a case without an
// account. The token lives in the URL (/upload/<token>); the public upload
// route resolves it to the case + owner. Expires after a window so a
// leaked link can't be used indefinitely.
export const uploadLinks = pgTable(
  'upload_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('upload_links_token_idx').on(t.token),
    index('upload_links_case_id_idx').on(t.caseId),
  ],
);

export type UploadLink = typeof uploadLinks.$inferSelect;
export type NewUploadLink = typeof uploadLinks.$inferInsert;

// --- Mailbox triage (REMOVED) ---------------------------------------------

// The mailbox-triage feature was removed (confusing UX). This table
// definition is retained, unused, so the schema still matches the
// existing database and no destructive migration is forced; nothing in
// the app reads or writes it anymore. Drop it with a dedicated migration
// when convenient. Emails now reach a case only via the per-case Outlook
// pull (see `listMessagesForCase` / `pull-outlook`).

export const MAILBOX_STATUSES = ['pending', 'assigned', 'ignored'] as const;
export type MailboxStatus = (typeof MAILBOX_STATUSES)[number];

export const mailboxMessages = pgTable(
  'mailbox_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id').notNull(),
    provider: text('provider').notNull(),

    // Graph message id (dedup key) + conversation id (thread grouping).
    externalId: text('external_id').notNull(),
    conversationId: text('conversation_id'),

    fromAddress: text('from_address'),
    fromName: text('from_name'),
    subject: text('subject'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    // bodyPreview only — the full body is fetched from Graph on assign,
    // so the triage table stays lean.
    snippet: text('snippet'),

    status: text('status').notNull().default('pending'),
    // The case it was routed to (assigned items). SET NULL if that case
    // is later deleted.
    assignedCaseId: uuid('assigned_case_id').references(() => cases.id, {
      onDelete: 'set null',
    }),
    // Haiku's suggestion + a one-line why.
    suggestedCaseId: uuid('suggested_case_id').references(() => cases.id, {
      onDelete: 'set null',
    }),
    suggestionReason: text('suggestion_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('mailbox_messages_owner_external_idx').on(t.ownerId, t.externalId),
    index('mailbox_messages_owner_status_idx').on(t.ownerId, t.status),
    index('mailbox_messages_owner_conversation_idx').on(t.ownerId, t.conversationId),
    check('mailbox_messages_provider_check', sql`${t.provider} IN ('outlook')`),
    check('mailbox_messages_status_check', sql`${t.status} IN ('pending','assigned','ignored')`),
  ],
);

export type MailboxMessage = typeof mailboxMessages.$inferSelect;
export type NewMailboxMessage = typeof mailboxMessages.$inferInsert;

// --- Auth.js (NextAuth) ---------------------------------------------------

// Standard Auth.js Drizzle-adapter tables — users / accounts / sessions /
// verification_tokens. Owned here in our schema (not a vendor), so they
// migrate with the DB. Column names follow the adapter's expectations
// (camelCase). `users.id` (text) is what every other table's `owner_id`
// references once real auth replaces the fence stand-in. JWT session
// strategy is used, so `sessions` is unused at runtime but kept for
// adapter completeness.

export const users = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').notNull(),
  emailVerified: timestamp('emailVerified', { mode: 'date', withTimezone: true }),
  image: text('image'),
});

export const accounts = pgTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export type User = typeof users.$inferSelect;

// --- Re-export combined for convenience in `db.ts`. -----------------------

export const tables = {
  clients,
  cases,
  sources,
  mailboxMessages,
  generations,
  generationMessages,
  integrationTokens,
  firmSettings,
  users,
  accounts,
  sessions,
  verificationTokens,
};
