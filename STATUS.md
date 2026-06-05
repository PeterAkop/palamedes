# Status

Snapshot of where Palamedes is, how the app is meant to work end to end,
and what's still to build. Update this whenever a meaningful slice
lands; reviewers should be able to read this in 5 minutes and know what
they're walking into.

_Last updated: 2026-06-05 — after `feat/db-cases` (PR #1)._

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
   **Opus 4.8** drafts it using the case summary + selected sources as
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
| `src/components/cases/` | `CaseSidebar`, `CaseTabs` (Overview / Sources / Tools). Client components for URL-state interactions. |
| `src/components/layout/Header.tsx` | Palamedes top bar. |
| `src/data/cases.ts` | View-model types + display labels (`CASE_TYPE_LABEL` etc.). _No data here any more_ — name is historical. |
| `src/lib/cases/queries.ts` | Owner-scoped DB queries + mappers from DB rows to view-model. |
| `src/db/schema.ts` | Drizzle tables, const tuples for enums, CHECK constraints. |
| `src/db/db.ts` | Drizzle client over Neon HTTP. Re-exports `schema`. |
| `src/db/migrations/` | Generated SQL (one file per migration) + meta. |
| `drizzle.config.ts` | drizzle-kit config; uses unpooled URL for DDL. |
| `scripts/seed-dev.mjs` | TRUNCATE-and-reseed dev fixture (3 clients + 4 cases). |
| `scripts/verify-db.mjs` | Post-migration sanity check (lists tables + columns). |

### Tech stack at a glance

- **Frontend:** Next 14 App Router · React 18 · TypeScript · Tailwind + DaisyUI (corporate theme) · Lucide icons.
- **State / network:** Server components for most pages; SWR + NDJSON streaming for chat-on-generation (when it lands).
- **DB:** Neon Postgres · Drizzle ORM · `@neondatabase/serverless` HTTP driver.
- **AI:** `@anthropic-ai/sdk` · Haiku 4.5 (summaries) · Opus 4.8 (tool drafts).
- **Files:** Vercel Blob (private) for uploads · Anthropic Files API for Claude inputs.
- **Tooling:** Biome (lint + format) · `drizzle-kit` (generate/migrate/studio) · Zod (input validation).

---

## 3. What's outstanding

### Phase A.1 remaining — sources, summaries, first tools

- **`sources` table.** Lands with its own migration. Schema sketch:
  `id`, `case_id` (FK), `owner_id`, `kind` (CHECK on
  `whatsapp|email|file|note|scan`), `title`, `content_preview`,
  `source_received_at`, `metadata` (jsonb for kind-specific fields),
  `status` (CHECK on `queued|processing|ready|failed`), `ai_summary`,
  `blob_path` (for files), `created_at`, `updated_at`.
- **Ingestion routes.**
  - Manual upload → Vercel Blob (private) → `sources` row → background
    Haiku summary job.
  - Add note (paste text) → `sources` row → Haiku.
  - Paste email / WhatsApp content → `sources` row → Haiku.
- **Per-source Haiku summary** as a queued background job. Today's UI
  already renders `status: 'processing'` and `aiSummary` empty-states
  — they'll come alive when the job lands.
- **Case summary** rolled up from source summaries (Haiku or Opus,
  TBD). Stored on `cases` (extends current `summary` column or adds
  `ai_summary` alongside the lawyer-authored one — decision pending).
- **`generations` + `generation_messages` tables.** For the Tools tab.
  Each tool run is a generation; refinement chat appends messages.
- **First two tools** (Client Care Letter, Spouse Visa Cover Letter).
  Static registry in code; later moves to `src/lib/tools/`. Inputs are
  the case summary + selected source summaries.
- **Chat-on-generation.** NDJSON streaming response + SWR mutation on
  the client.
- **Collapsible sidebar.** URL-state hook is already wired
  (`?sidebar=hidden`); the visual collapse is in place. Confirm it
  survives the migration to DB-backed sidebar items.
- **"New case" button** (currently `disabled` in `CaseSidebar`).
- **"Add note" / "Upload" buttons** in the Sources tab (currently
  `disabled` in `CaseTabs`).

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
