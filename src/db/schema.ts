import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Palamedes DB schema.
//
// `owner_id` on every table is `text` (not uuid) so it can hold any
// future auth provider's user id without a column-type migration —
// Supabase Auth issues UUIDs, Clerk/Auth.js issue strings like
// `user_2abc…`. Today every row carries the fence constant from
// `getCurrentUserId()` in src/lib/auth.ts (Phase A.1 single-tester
// POC behind the HTTP Basic fence).
//
// Future tables: sources, generations, generation_messages. Each
// lands with its own phase.

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
    // Manually-authored case description from the lawyer. The
    // AI-generated *case summary* (across all sources) lives in
    // separate columns added by the source-AI branch.
    summary: text('summary'),
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

// --- Source-kind metadata table re-export friendly ------------------------

// Future tables placeholder for documentation — when sources/
// generations/generation_messages land, their schema goes below with
// the same pattern (CHECK constraints on enum-y columns, jsonb for
// kind-specific fields).

// Re-export combined for convenience in `db.ts`.
export const tables = { clients, cases };
