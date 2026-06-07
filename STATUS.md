# Status

Snapshot of where Palamedes is, how the app is meant to work end to end,
and what's still to build. Update this whenever a meaningful slice
lands; reviewers should be able to read this in 5 minutes and know what
they're walking into.

_Last updated: 2026-06-07 — `feat/sources-files`: file upload (Vercel Blob + Anthropic Files API + Haiku file summaries) landed; paste email / WhatsApp ingestion added._

---

## 1. What we've done

### Phase 0 — scaffold (commits before `feat/db-cases`)

- Next.js 14 App Router + TypeScript + Tailwind + DaisyUI (corporate
  theme) + Biome for lint/format.
- HTTP Basic Auth fence in `src/middleware.ts` — set both `BASIC_USER`
  and `BASIC_PASS` or the app returns `503` (fail closed).
- App shell with the Palamedes header (`src/components/layout/Header.tsx`)
  and a landing page CTA-ing "Add your first case".
- `src/lib/auth.ts` — `getCurrentUserId()` stand-in that returns the
  constant `fence-user`. Every owner-scoped table uses this until real
  auth lands.

### Phase A.1 first slice — cases UI on the database (`feat/db-cases`, PR #1)

- **DB stack.** Neon Postgres + Drizzle ORM. App talks to Neon over
  HTTP (`@neondatabase/serverless`) at runtime; `drizzle-kit migrate`
  uses the direct (`DATABASE_URL_UNPOOLED`) connection because DDL is
  incompatible with PgBouncer transaction-mode pooling.
- **Schema.** `clients` and `cases` tables (`src/db/schema.ts`) with:
  - `owner_id: text` on every table — provider-agnostic so any future
    auth provider's ID format (Neon Auth, Clerk, Auth.js, Supabase)
    fits without a column-type migration.
  - `CASE_TYPES` and `CASE_STATUSES` const tuples driving both the
    Drizzle-inferred TS unions and `CHECK` constraints on the columns
    — one source of truth, no drift.
  - Indexes on `owner_id` (both tables) and on `cases.client_id`.
- **Migration applied.** `0000_brown_joshua_kane.sql` is on the Neon
  database.
- **Query layer.** `src/lib/cases/queries.ts` exposes owner-scoped
  `listSidebarItems`, `getCaseById`, `getClientById`. Mappers translate
  DB rows (`null`, `Date`, generic `text`) into the view-model
  (`undefined`, ISO strings, narrowed unions) the UI components expect.
- **UI swap.** `src/app/cases/layout.tsx` and `src/app/cases/[id]/page.tsx`
  are now `async` server components awaiting the queries; nothing
  reads hardcoded data any more. The Basic Auth fence and the
  sidebar/tabs UX all still work.
- **Dev fixtures.** `scripts/seed-dev.mjs` TRUNCATEs and reseeds three
  sample clients (Patel, Singh, Khan) and four cases (ILR,
  Naturalisation, Spouse Visa, Appeal). Run with `node
  scripts/seed-dev.mjs`. `scripts/verify-db.mjs` prints table shapes
  to confirm a migration landed cleanly.

### Phase A.1 second slice — sources DB + note ingestion + Haiku summaries (`feat/sources`)

- **`sources` table** in `src/db/schema.ts` with FK to `cases` (cascade
  delete), `owner_id`, kind (`whatsapp|email|file|note|scan`) and
  status (`queued|processing|ready|failed`) CHECK-constrained against
  `SOURCE_KINDS` / `SOURCE_STATUSES` const tuples, `metadata` jsonb
  for kind-specific fields, plus `ai_summary` / `ai_summary_model` /
  `blob_path` / `anthropic_file_id` / `error_message` columns ready
  for files (slice 2) and async retry (later).
- **Anthropic SDK plumbed.** `src/lib/anthropic.ts` — one shared
  client, `MODELS = { haiku: 'claude-haiku-4-5', opus: 'claude-opus-4-7' }`.
- **Haiku summariser.** `src/lib/sources/summarize.ts` —
  `summarizeNote({ title, body })` calls Haiku with a UK-immigration-
  solicitor system prompt, returns `{ summary, model }`. No streaming
  / tool use / caching in slice 1 (note prompts are well below
  Haiku's 4K cacheable minimum).
- **Note ingestion route.** `POST /api/sources/notes` validates body
  with Zod, checks case ownership, inserts a `processing` source,
  runs Haiku synchronously, updates to `ready` (or `failed` with
  `error_message`), returns the row.
- **UI wired.** `src/components/cases/AddNoteButton.tsx` (client) —
  daisyUI `<dialog>` modal, calls the route, `router.refresh()` on
  success so the server component re-fetches with the new row. The
  previously-`disabled` "Add note" button in the Sources tab now
  opens this modal. Upload still disabled (slice 2).
- **Seed enriched.** Seven sample notes (3 on Patel ILR, 2 on Singh
  Spouse Visa, 2 on Khan Appeal) with pre-computed summaries
  (`ai_summary_model='seed'`). Sources tab is rich on first load.

### Phase A.1 third slice — file upload (`feat/sources-files`)

- **Vercel Blob client.** `src/lib/blob.ts` wraps `@vercel/blob`'s
  `put()` — uploads land at `sources/<filename>-<random>`. `access:
  'public'` with random suffix means the URL is unguessable; the
  app gates discovery behind the Basic Auth fence. Per-user signed
  URLs are a Phase B concern.
- **Anthropic Files API.** Upload route calls
  `anthropic.beta.files.upload(...)` with `betas:
  ['files-api-2025-04-14']`; the returned `file_id` is stored on
  the `sources` row and referenced from the Haiku call.
- **Haiku file summariser.** `summarizeFile({ title, mimeType,
  anthropicFileId })` in `src/lib/sources/summarize.ts`. PDFs go as
  `{type: 'document', source: {type: 'file', file_id: …}}`; images
  (JPEG / PNG / WebP) go as `{type: 'image', …}` so vision handles
  them. Separate system prompt from notes — primes Claude for
  scanned docs, payslips, refusal letters.
- **Upload route.** `POST /api/sources/upload` (multipart, Node
  runtime). Validates type (PDF / JPEG / PNG / WebP) and size
  (≤25 MB). Inserts row → uploads to Blob → uploads to Anthropic
  Files API → stores both refs → summarises → marks `ready` (or
  `failed` with `error_message`). Returns the row.
- **UI.** `src/components/cases/UploadButton.tsx` — hidden
  `<input type="file">` triggered by the visible button; loading
  state (spinner + "Summarising…") during the round-trip; inline
  error display next to the button. Replaces the previously-
  `disabled` Upload button in the Sources tab.
- **Caveat.** Vercel's default serverless body limit is ~4.5 MB.
  Files larger than that on a Vercel deployment will 413. The
  fix is Vercel Blob's client-direct (signed-URL) upload pattern;
  swap when real lawyers hit it.

### Phase A.1 fourth slice — paste email / WhatsApp (`feat/sources-files`)

- **Paste summariser.** `summarizePastedMessage({ kind, title, body,
  from, subject, fromPhone })` in `src/lib/sources/summarize.ts` —
  text-only Haiku call sharing `summarizeNote`'s plumbing but with a
  correspondence-primed system prompt; the sender / subject / phone
  metadata is threaded into the prompt so the summary can cite it.
- **Paste route.** `POST /api/sources/paste` (Zod-validated) —
  `kind` is `email | whatsapp`, body up to 50K chars, optional
  `from` / `subject` / `fromPhone` / `receivedAt`. Stores
  kind-specific `metadata` jsonb (`{from, subject}` for email,
  `{from_phone}` for WhatsApp) and `source_received_at`. Same
  insert-`processing` → summarise → `ready`/`failed` pattern as
  notes and uploads.
- **UI.** `src/components/cases/PasteButton.tsx` — `<dialog>` modal
  with an email/WhatsApp kind picker that toggles the metadata
  fields (subject vs from-phone). Wired into the Sources tab beside
  Add note / Upload. `CaseTabs` now renders the correspondence
  metadata (from / subject / phone) in each source card.
- **Seed enriched.** Three pasted-message fixtures (2 email, 1
  WhatsApp) with metadata + `source_received_at`, so the Sources tab
  shows the email/WhatsApp kinds and metadata on first load.

---

## 2. How the app should work

### Product workflow (the user's day)

The user is a UK immigration solicitor. For each case (one client may
have multiple), they:

1. **Drop in sources.** WhatsApp threads, client emails (forwarded or
   pasted), files (scanned passports, P60s, marriage certificates,
   refusal letters), and manual notes. Sources can also arrive via
   inbound channels we route (Phase A.2: WhatsApp Business sandbox +
   Outlook).
2. **Get AI summaries.** Each source is summarised by **Haiku 4.5** in
   the background. The case as a whole gets a **case summary** rolled
   up across sources.
3. **Generate documents.** Pick a tool (e.g. _Cover Letter — ILR_) and
   **Opus 4.7** drafts it using the case summary + selected sources as
   context. The lawyer can chat with the model to refine the draft.
4. **Review, edit, sign, file.** The AI never sends anything to the
   Home Office or the client; it produces drafts the solicitor signs
   off on. Decision support, not legal advice.

### Architecture in one paragraph

Next.js 14 App Router app behind an HTTP Basic Auth fence. Server
components render every page (`/cases` is `force-dynamic` — nothing
prerenders behind the fence). They `await` Drizzle queries against
Neon over HTTP. Anthropic SDK is called from server-only routes
(Haiku for summaries, Opus for tool drafts), with NDJSON streaming and
SWR on the client for the chat-on-generation experience. File uploads
go to Vercel Blob (private) and to the Anthropic Files API for
document inputs to Claude. All rows carry `owner_id` for future
multi-tenancy.

### File map

| Path | What lives here |
|---|---|
| `src/middleware.ts` | HTTP Basic Auth fence (fail-closed on missing env). |
| `src/lib/auth.ts` | `getCurrentUserId()` — fence stand-in until real auth. |
| `src/app/` | Routes. `cases/layout.tsx` owns the sidebar; `cases/[id]/page.tsx` the detail view. |
| `src/components/cases/` | `CaseSidebar`, `CaseTabs` (Overview / Sources / Tools), `AddNoteButton`, `UploadButton`, `PasteButton`. Client components for URL-state interactions and source ingestion. |
| `src/components/layout/Header.tsx` | Palamedes top bar. |
| `src/data/cases.ts` | View-model types + display labels (`CASE_TYPE_LABEL` etc.). _No data here any more_ — name is historical. |
| `src/lib/cases/queries.ts` | Owner-scoped case + client queries, plus the view-model mapper that calls into `sources/queries.ts`. |
| `src/lib/sources/queries.ts` | Owner-scoped `listSourcesForCase` + DB→view mapper. |
| `src/lib/sources/summarize.ts` | `summarizeNote` + `summarizeFile` + `summarizePastedMessage` — Haiku 4.5 calls with the UK-immigration system prompts. |
| `src/lib/anthropic.ts` | Shared Anthropic SDK client + `MODELS` table. Server-only. |
| `src/lib/blob.ts` | Vercel Blob wrapper (`uploadSourceFile`). Server-only. |
| `src/app/api/sources/notes/route.ts` | `POST` handler for note creation (Zod validation, ownership check, Haiku call). |
| `src/app/api/sources/upload/route.ts` | `POST` multipart handler — Blob + Files API + Haiku summary. |
| `src/app/api/sources/paste/route.ts` | `POST` handler for pasted email / WhatsApp (Zod, ownership check, metadata, Haiku call). |
| `src/db/schema.ts` | Drizzle tables (`clients`, `cases`, `sources`), const tuples for enums, CHECK constraints. |
| `src/db/db.ts` | Drizzle client over Neon HTTP. Re-exports `schema`. |
| `src/db/migrations/` | Generated SQL (one file per migration) + meta. |
| `drizzle.config.ts` | drizzle-kit config; uses unpooled URL for DDL. |
| `scripts/seed-dev.mjs` | TRUNCATE-and-reseed dev fixture (3 clients + 4 cases + 7 notes + 3 pasted messages). |
| `scripts/verify-db.mjs` | Post-migration sanity check (lists tables + columns). |

### Tech stack at a glance

- **Frontend:** Next 14 App Router · React 18 · TypeScript · Tailwind + DaisyUI (corporate theme) · Lucide icons.
- **State / network:** Server components for most pages; SWR + NDJSON streaming for chat-on-generation (when it lands).
- **DB:** Neon Postgres · Drizzle ORM · `@neondatabase/serverless` HTTP driver.
- **AI:** `@anthropic-ai/sdk` · Haiku 4.5 (summaries) · Opus 4.7 (tool drafts).
- **Files:** Vercel Blob (private) for uploads · Anthropic Files API for Claude inputs.
- **Tooling:** Biome (lint + format) · `drizzle-kit` (generate/migrate/studio) · Zod (input validation).

### Database schema

Three tables today: `clients`, `cases`, `sources`. Authoritative source
is `src/db/schema.ts` (Drizzle); the listing below mirrors it so the
shape is reviewable without leaving this doc.

**Shared conventions across all tables:**

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — every row.
- `owner_id text NOT NULL` — every row. `text` (not `uuid`) so it
  fits any future auth provider's user-id format without a column-
  type migration. Today every row carries `'fence-user'` from
  `getCurrentUserId()` in `src/lib/auth.ts`.
- `created_at` + `updated_at` — `timestamp with time zone NOT NULL
  DEFAULT now()`. Application code updates `updated_at` explicitly
  on mutating writes (no DB trigger today).
- Drizzle infers `$inferSelect` / `$inferInsert` types — re-exported
  as `Client` / `NewClient`, `Case` / `NewCase`, `Source` / `NewSource`
  from `@/db/db` so the rest of the app imports from one place.

#### `clients`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | — | PK, default `gen_random_uuid()` |
| `owner_id` | text | NOT NULL | indexed |
| `first_name` | text | NOT NULL | |
| `last_name` | text | NOT NULL | |
| `email` | text | NULL | |
| `phone` | text | NULL | |
| `date_of_birth` | date | NULL | |
| `nationality` | text | NULL | |
| `preferred_language` | text | NULL | |
| `notes` | text | NULL | free-form lawyer notes on the client |
| `created_at`, `updated_at` | timestamptz | NOT NULL | default `now()` |

Indexes: `clients_owner_id_idx (owner_id)`.

#### `cases`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | — | PK, default `gen_random_uuid()` |
| `client_id` | uuid | NOT NULL | FK → `clients(id)` ON DELETE CASCADE |
| `owner_id` | text | NOT NULL | indexed |
| `title` | text | NOT NULL | |
| `case_type` | text | NOT NULL | CHECK against `CASE_TYPES` |
| `status` | text | NOT NULL | CHECK against `CASE_STATUSES`, default `'open'` |
| `home_office_reference` | text | NULL | e.g. `IHS-2026-…`, `GWF-…`, `IA/…` |
| `deadline` | date | NULL | |
| `summary` | text | NULL | lawyer-authored; AI-generated case summary lands in its own column later |
| `created_at`, `updated_at` | timestamptz | NOT NULL | default `now()` |

Indexes: `cases_client_id_idx (client_id)`, `cases_owner_id_idx (owner_id)`.

CHECK constraints (enforced at the DB level alongside Drizzle's TS unions):

- `CASE_TYPES` = `spouse-visa`, `family-visa`, `ilr`, `naturalisation`, `work-visa`, `study-visa`, `eu-settlement`, `extension`, `appeal`, `asylum`, `sponsorship`, `other`.
- `CASE_STATUSES` = `open`, `in_progress`, `submitted`, `granted`, `refused`, `on_hold`, `closed`.

#### `sources`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | — | PK, default `gen_random_uuid()` |
| `case_id` | uuid | NOT NULL | FK → `cases(id)` ON DELETE CASCADE |
| `owner_id` | text | NOT NULL | indexed |
| `kind` | text | NOT NULL | CHECK against `SOURCE_KINDS` |
| `title` | text | NOT NULL | shown on the source card |
| `content_preview` | text | NULL | leading chars for collapsed cards; null for files |
| `source_received_at` | timestamptz | NULL | email/message date or file mtime; distinct from `created_at` |
| `metadata` | jsonb | NULL | kind-specific (`from`/`subject`, `from_phone`, `mime_type`/`size_bytes`, …) |
| `status` | text | NOT NULL | CHECK against `SOURCE_STATUSES`, default `'queued'`, indexed |
| `error_message` | text | NULL | populated only when `status='failed'` |
| `ai_summary` | text | NULL | Haiku output |
| `ai_summary_model` | text | NULL | which model produced it (e.g. `claude-haiku-4-5-20251001`, `'seed'` for fixtures) |
| `blob_path` | text | NULL | Vercel Blob URL (file/scan kinds, slice 2) |
| `anthropic_file_id` | text | NULL | Anthropic Files API id (file/scan kinds, slice 2) |
| `created_at`, `updated_at` | timestamptz | NOT NULL | default `now()` |

Indexes: `sources_case_id_idx (case_id)`, `sources_owner_id_idx (owner_id)`, `sources_status_idx (status)`. The status index is cheap and ready for the future "find all `queued` sources to process" worker.

CHECK constraints:

- `SOURCE_KINDS` = `whatsapp`, `email`, `file`, `note`, `scan`.
- `SOURCE_STATUSES` = `queued`, `processing`, `ready`, `failed`.

#### Foreign keys at a glance

```
clients ─┐
         └─ cases.client_id  (ON DELETE CASCADE)
                  └─ sources.case_id  (ON DELETE CASCADE)
```

Deleting a client cascades through cases → sources. There are no
`ON UPDATE` rules; primary keys are immutable UUIDs.

#### Tables not in the DB yet

- `generations` + `generation_messages` — for the Tools tab (Opus 4.7
  drafts + chat-on-generation refinement). Each tool run is a
  `generation`; each refinement turn is a `generation_message`. Land
  on the `feat/tools` branch.
- AI case-summary columns on `cases` (rolled up across sources) —
  land with the case-summary slice. Likely `ai_summary` +
  `ai_summary_model` + `ai_summary_generated_at` alongside the
  existing lawyer-authored `summary`.

---

## 3. What's outstanding

### Phase A.1 remaining — tools

- **Per-source delete + retry.** Source row exposes
  `error_message` when `status='failed'`; we need a UI affordance
  to retry the summary, plus delete.
- **Case summary** rolled up from source summaries (Haiku or Opus,
  TBD). Stored on `cases` (extends current `summary` column or adds
  `ai_summary` alongside the lawyer-authored one — decision pending).
  Where prompt caching first earns its keep — the case context will
  cross Haiku's 4K cacheable minimum.
- **`generations` + `generation_messages` tables (`feat/tools`).**
  For the Tools tab. Each tool run is a generation; refinement chat
  appends messages.
- **First two tools** (Client Care Letter, Spouse Visa Cover Letter).
  Static registry in code; later moves to `src/lib/tools/`. Inputs are
  the case summary + selected source summaries. Opus 4.7.
- **Chat-on-generation.** NDJSON streaming response + SWR mutation on
  the client.
- **Collapsible sidebar.** URL-state hook is already wired
  (`?sidebar=hidden`); the visual collapse is in place. Confirm it
  survives the migration to DB-backed sidebar items.
- **"New case" button** (currently `disabled` in `CaseSidebar`).
- **"Add note", "Upload", and "Paste email / WhatsApp"** are all
  live in the Sources tab.

### Phase A.2 — inbound channels

- **WhatsApp Business sandbox webhook.** Verify, parse, route to the
  right case (by phone number lookup against `clients.phone`), create
  a `source` row.
- **Outlook (Microsoft Graph) webhook.** Same pattern keyed on
  `clients.email`.
- **Routing rules.** Unrouted messages need an "unassigned" inbox /
  triage path.

### Phase B — solicitor-grade polish

- More tools — cover letters for ILR, Naturalisation, Family Visa
  variants; appeal grounds variants.
- Deadlines view (calendar / list) with reminders.
- **Bundle PDF export** — assemble the case bundle for tribunals.
- **Real auth.** Open decision between Neon Auth (Stack Auth), Clerk,
  Auth.js, and Supabase Auth. `owner_id: text` accommodates any of
  them; the only code change is `getCurrentUserId()`. See "Neon Auth"
  digression below.
- Real multi-tenancy beyond the single fence user (firms with multiple
  solicitors; client portals out of scope for now).

### Cross-cutting / not phase-bound

- **No tests yet.** When the first non-trivial logic lands (the source
  ingest router is a strong candidate), set up Vitest + a Drizzle
  test-db pattern.
- **No observability.** Should add structured logging, error tracking
  (Sentry?), and Anthropic spend monitoring before letting a real
  solicitor near it.
- **No CI.** GitHub Actions running `biome check` + `tsc --noEmit` on
  PRs would catch the obvious stuff.
- **`.env.example` ≠ deployment env.** When we deploy to Vercel, the
  same vars need to be set there (Neon URLs are auto-injected via
  Storage; `ANTHROPIC_API_KEY`, `BASIC_USER`, `BASIC_PASS`, and the
  Blob tokens are manual).

### Neon Auth digression

The Neon Storage UI offers a one-click "Auth — built-in authentication
for app users, with profiles synced to Postgres". This is Stack Auth +
a `neon_auth.users_sync` table you can JOIN against in your own
queries. **Not enabled.** Reasons:

- Phase A.1 explicitly defers auth; we're behind the Basic Auth fence.
- Enabling it now would either sit unused or pull real auth scope into
  the current branch.
- It's not a one-way door — togglable later from the same Storage
  settings; `owner_id: text` accommodates whatever provider we pick.

Worth re-evaluating in Phase B alongside Clerk / Auth.js.
