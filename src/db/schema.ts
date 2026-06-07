import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
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
// Future tables: generations, generation_messages. Each lands with
// its own phase.

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

    // Storage references — populate only for file/scan kinds.
    // `blob_path` is the Vercel Blob URL (private); `anthropic_file_id`
    // is what we pass to the Anthropic Files API for Claude inputs.
    blobPath: text('blob_path'),
    anthropicFileId: text('anthropic_file_id'),

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
    check('sources_kind_check', sql`${t.kind} IN ('whatsapp','email','file','note','scan')`),
    check('sources_status_check', sql`${t.status} IN ('queued','processing','ready','failed')`),
  ],
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

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

// --- Re-export combined for convenience in `db.ts`. -----------------------

export const tables = { clients, cases, sources, generations, generationMessages };
