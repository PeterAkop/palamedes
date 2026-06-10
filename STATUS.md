# Status

Snapshot of where Palamedes is, how the app is meant to work end to end,
and what's still to build. Update this whenever a meaningful slice
lands; reviewers should be able to read this in 5 minutes and know what
they're walking into.

_Last updated: 2026-06-10 — **A.1 + Outlook (pull + triage) on `main`; real auth in flight.** Merged: A.1, the Outlook per-case pull (PR #5), settings (PR #6), and the **mailbox triage inbox with Haiku suggestions** (PR #7). In flight on `feat/auth`: **real per-user auth via Auth.js — "Sign in with Microsoft"** (Drizzle adapter → users in our own Postgres; JWT sessions; middleware replaces the Basic Auth fence; `getCurrentUserId()` now reads the session). Migrations 0005/0006 to apply; AUTH_* env to set. See §3 "Real auth"._

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
  `put()` — uploads land at `sources/<filename>-<random>`. Originally
  `access: 'public'`; later switched to **`access: 'private'`** (see
  post-completion polish) since these are sensitive client documents.
  A "view original" feature would mint short-lived signed URLs.
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

### Phase A.1 fifth slice — source lifecycle + case summary + New case (`feat/sources-files`)

- **Per-source delete + retry.** `DELETE /api/sources/[id]` (owner-scoped)
  and `POST /api/sources/[id]/retry` (re-runs the Haiku summary,
  dispatching by kind via `summarizeSource` in
  `src/lib/sources/process.ts`). `SourceActions.tsx` adds the buttons to
  each source row; `error_message` is shown on failed rows. (Blob /
  Anthropic-file cleanup on delete is deferred — TODO in the route.)
- **AI case summary.** New `ai_summary` / `ai_summary_model` /
  `ai_summary_generated_at` columns on `cases` (**migration 0002**),
  separate from the lawyer-authored `summary`. `summarizeCase` (Haiku,
  cacheable system prefix) rolls up the per-source summaries;
  `POST /api/cases/[id]/summary` writes them; the Overview "Regenerate"
  button (`RegenerateSummaryButton.tsx`) is now live.
- **New case (+ inline client).** `POST /api/cases` takes either an
  existing `clientId` or a `newClient` object (created inline, sequential
  writes — Neon HTTP has no interactive tx). `NewCaseButton.tsx` (modal
  with existing/new-client toggle) replaces the disabled sidebar "New"
  button; the layout passes the client list.
- **Opus bumped to 4.8.** `MODELS.opus = 'claude-opus-4-8'`.

### Phase A.1 sixth slice — Tools tab (`feat/tools`)

- **generations schema.** `generations` + `generation_messages` tables
  (**migration 0003**) with `GENERATION_STATUSES` /`GENERATION_ROLES`
  tuples + CHECK constraints, cascade FKs case→generation→message.
  `listGenerationsForCase` populates the previously-stubbed
  `generations` array in the case view-model.
- **Tool registry.** `src/lib/tools/registry.ts` — two tools (Client
  Care Letter, Cover Letter — Spouse Visa) with system prompts +
  `buildUserPrompt`. `src/lib/tools/context.ts` assembles the Opus
  input (AI case summary + selected source summaries).
- **Streaming drafts.** `POST /api/generations` inserts a generation +
  initial user message, then streams an Opus 4.8 draft as **NDJSON**
  (adaptive thinking, effort high, `max_tokens` 64K) via the shared
  `streamGeneration` helper, persisting the assistant turn + flipping
  status on completion. `POST /api/generations/[id]/messages` is the
  chat-on-generation refine path — re-streams with the full thread.
- **UI.** `ToolRunner.tsx` — per-tool modal: source picker + optional
  instructions → streamed draft → refine-by-chat. Replaces the disabled
  Generate/New-run buttons in the Tools tab.

### Phase A.1 — post-completion fixes & polish (running locally)

Landed while running the app locally against live Neon / Anthropic /
Vercel Blob:

- **Delete a case.** `DELETE /api/cases/[id]` (owner-scoped; FK cascades
  remove the case's sources → generations → generation_messages).
  `DeleteCaseButton.tsx` adds a confirm modal in the case header; on
  success navigates to `/cases`. Blob/Anthropic-file cleanup deferred.
- **Private Blob storage.** `uploadSourceFile` now uses
  `access: 'private'` (sensitive client docs — passports, payslips). The
  blob URL is no longer public; nothing reads it back by URL today (AI
  uses the Anthropic `file_id`; `blob_path` is archival). A "view
  original" feature would mint short-lived signed URLs.
- **Mutation refresh fix (important).** `router.refresh()` does **not**
  re-render after a mutation because the project enables
  `experimental.staleTimes` (next.config), which makes Next 14.2.x serve
  the cached RSC instead of refetching — newly added notes / sources /
  summaries / generations only appeared after a hard reload. Replaced
  every `router.refresh()` with a **`revalidateCases()` server action**
  (`src/app/cases/actions.ts` → `revalidatePath('/cases', 'layout')`),
  which invalidates and re-renders reliably (covers the detail page +
  the sidebar). All mutation components use it.
- **Tools: view / continue a stored generation.** A "View" button
  re-opens the latest draft + thread (read from `caseData.generations`,
  no fetch) and lets the lawyer keep refining it.
- **Tools: refine rewrites in place.** The draft is a single living
  document — a refine re-streams a full rewritten letter that *replaces*
  the current one (no more stacking versions). To keep input tokens flat
  per round, refine sends a **bounded** context to Opus — the original
  case-context prompt (message 0) + the *current* draft + the new
  instruction — not the whole back-and-forth. The full thread is still
  persisted in `generation_messages` for the record.
- **Tools: manual edit.** A pencil button opens the draft in a textarea;
  Save persists via `POST /api/generations/[id]/edit` (updates the
  latest assistant message in place, so later refines build on the edit).
- **Tools: streaming state.** While generating / refining, the refine
  input is disabled and a "Refining the draft…/Generating…" spinner
  shows; the prior draft dims until new text streams in.

### Phase A.2 first slice — Outlook pull integration (`feat/outlook-integration`)

First inbound channel, **pull-on-demand** (no cron/webhooks). The lawyer
connects their own Outlook mailbox once, then a per-case **"Pull from
Outlook"** button imports the client's emails as `email` sources. See
"Outlook integration — how the pull works" in §2 for the full flow.

- **DB (migration 0004):** `integration_tokens` table (OAuth tokens per
  owner+provider, AES-GCM encrypted at rest) + `sources.external_id`
  (Graph message id) for dedup.
- **Lib (`src/lib/outlook/`):** `oauth.ts` (authorize/exchange/refresh),
  `graph.ts` (`getConnectedEmail`, `listMessagesForEmail`), `tokens.ts`
  (save / `getConnection` / `getValidAccessToken` with auto-refresh),
  `crypto.ts` (AES-256-GCM).
- **Routes:** `GET /api/integrations/outlook/connect` (+ `/callback`)
  for the delegated OAuth flow; `POST /api/cases/[id]/pull-outlook` for
  the import.
- **UI:** `OutlookCaseActions` in the case header — "Connect Outlook" or
  "Pull from Outlook" (disabled without a client email); pulled sources
  carry an **"Outlook"** badge in the Sources tab.
- **Env:** `MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_TENANT` (=`common`) /
  `MS_REDIRECT_URI` / `MS_TOKEN_ENC_KEY`. App registered as
  multitenant+personal so any mailbox (firm M365 or personal Outlook)
  can connect. **Merged to `main`** (PR #5); migration 0004 to apply.
- **Settings page** (PR #6): `/settings` shows the connected mailbox +
  Connect/Disconnect; Triage/Settings links in the header.

### Phase A.2 second slice — mailbox triage with AI suggestions (`feat/email-triage`)

Solves address-only matching's blind spots (self-forwards, threads
without the client, internal notes). A **mailbox triage inbox**: pull
recent messages (not address-filtered), Haiku **suggests the case** per
message, the lawyer **assigns** (one-click on the suggestion / pick
another / whole thread) or **ignores**. See "Email triage — how it
works" in §2. The per-case pull stays as the fast path.

- **DB (migration 0005):** `mailbox_messages` — triage candidates with
  `status` (pending/assigned/ignored), `conversation_id`,
  suggested/assigned case FKs. Unique `(owner, external_id)`.
- **Lib:** `graph.ts` gains `listRecentMessages` + `getMessageById`;
  `sources/fromEmail.ts` factors `createEmailSourceFromOutlook` (shared
  by pull + assign, **idempotent** — an email can't be added to a case
  twice); `triage/suggest.ts` (Haiku forced-tool `{caseId|null, reason}`);
  `triage/queries.ts`.
- **Routes:** `POST .../triage/sync` (pull + suggest), `.../triage/[id]/assign`
  (+ `includeThread`), `.../triage/[id]/ignore`.
- **UI:** `/triage` page (`TriageList`/`TriageRow`); header **Triage**
  link with a live pending-count badge; a **Cases** link too.
- On `feat/email-triage`; migration 0005 to apply.

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

### Tool generation — what context goes to the AI

This is the contract for every tool (Client Care Letter, Cover Letter —
Spouse Visa, and any future tool — they all share one code path). Three
operations, each with a deliberately-scoped payload:

**1. Generate a draft** (`POST /api/generations`)

- `system` = the tool's drafting prompt (`registry.ts` → `systemPrompt`).
- `user` = `buildUserPrompt(ctx)` where `ctx` is assembled by
  `buildToolContext` (`src/lib/tools/context.ts`) from:
  - the case title + type,
  - the client's name,
  - the **AI case summary** (`cases.ai_summary`, if generated),
  - the **AI summaries of the selected sources** (the lawyer picks which
    in the run dialog; default = all `ready` sources),
  - the optional free-text instructions typed at run time.
- **Only the Haiku summaries go to Opus — never the raw note/email
  bodies or the uploaded files.** Source files reach Claude *at
  summarisation time* via the Files API; tool generation works off the
  distilled summaries. This keeps the prompt compact and on-topic.
- Model: Opus 4.8, streamed (adaptive thinking, effort high).

**2. Refine a draft** (`POST /api/generations/[id]/messages`)

- Bounded context to keep input tokens flat round-to-round:
  `system` (tool prompt) + the **original case-context prompt**
  (message 0, i.e. the same case summary + selected sources snapshot) +
  the **current draft** (latest assistant message, including any manual
  edit) + the **new instruction**.
- The intermediate back-and-forth is **not** re-sent. The full thread is
  still persisted in `generation_messages` for the record.
- The case context is the **snapshot from generation time** — a refine
  does *not* re-read newly-added sources or a regenerated case summary.
  Use **New run** to pick up fresh case state.

**3. Manual edit** (`POST /api/generations/[id]/edit`)

- No AI call. Overwrites the latest assistant message in place, so the
  edited text becomes "the current draft" and any later refine builds on
  it.

### Outlook integration (Microsoft Graph) — how the pull works

Phase A.2's first inbound channel. **Pull-on-demand, delegated OAuth, no
cron.** The solicitor connects their *own* Outlook mailbox once; a
per-case button imports the client's emails. Lib lives in
`src/lib/outlook/`; routes under `src/app/api/integrations/outlook/` and
`src/app/api/cases/[id]/pull-outlook`.

**Connecting (one-time per mailbox).** OAuth authorization-code flow:

1. `GET /api/integrations/outlook/connect` sets a CSRF `state` cookie and
   redirects to Microsoft's consent screen (scopes `Mail.Read`,
   `offline_access`, `User.Read`).
2. The user signs in with their mailbox and approves.
3. Microsoft redirects to `GET /api/integrations/outlook/callback`, which
   verifies the `state` cookie, exchanges the `code` for an **access +
   refresh token** (server-to-server), reads the mailbox address via
   Graph, and stores the tokens **AES-256-GCM encrypted** in
   `integration_tokens` (keyed by owner+provider; `MS_TOKEN_ENC_KEY`).
   It then `revalidatePath('/cases','layout')`s and redirects back so the
   header flips to "Pull from Outlook".

Tokens never touch the browser — the only cookie is the temporary CSRF
`state`. The app is registered **multitenant+personal** (`MS_TENANT=common`)
so any mailbox (firm M365 or personal Outlook.com) can connect.

**Pulling (per case).** `POST /api/cases/[id]/pull-outlook`:

1. Owner-scoped; resolves the case's **client email** (`clients.email`).
   The button is disabled if the client has no email (nothing to match).
2. `getValidAccessToken()` returns a usable token, **auto-refreshing** via
   the stored refresh token if the access token is within 60s of expiry.
3. Graph `GET /me/messages?$search="<client email>"` (top 25) returns
   messages where that address is a participant; bodies are HTML→text'd.
4. **Dedup:** skip any whose Graph message id already exists as a
   `sources.external_id` on this case — so re-pulling never duplicates.
5. Each fresh message becomes an `email` source tagged
   `metadata.origin = 'outlook'` (→ the **"Outlook" badge**), with
   `external_id` = the Graph id and `source_received_at` = the email date,
   then Haiku-summarised via the same `summarizePastedMessage` used for
   pasted email. Returns `{ imported, skipped }`.

**POC limits / notes.** Pulls the ~25 best `$search` matches (no
pagination), summarises synchronously (fine locally; a background job is
later if mailboxes are large), and the access token is read fresh per
request. Disconnect is in **Settings**. Webhooks / continuous sync are a
later phase and need a public HTTPS endpoint (a Vercel deploy first).

### Email triage (Microsoft Graph) — how it works

For when address-only matching isn't enough. The lawyer opens **Triage**
(header link, with a pending-count badge) and **Syncs**:

1. **Sync** (`POST …/triage/sync`) — pulls the 25 most-recent mailbox
   messages (date-ordered, *not* `$search`-filtered), inserts the new
   ones as `pending` `mailbox_messages` (skipping any already tracked —
   pending/assigned/ignored — by `(owner, message id)`), then runs Haiku
   over each to **suggest a case** (`{caseId|null, reason}` against the
   owner's cases — never guesses) and stores it.
2. **Triage** (`/triage`) — each pending item shows the email + the
   suggested case + reason, a **case picker** (defaulting to the
   suggestion), and **Assign** / **Ignore**, plus an optional **whole
   thread** toggle (assigns same-`conversationId` pending siblings too).
3. **Assign** (`POST …/triage/[id]/assign`) — fetches the full message
   (`getMessageById`), creates an `email` source on the case via the
   shared `createEmailSourceFromOutlook` (Outlook badge + summary), and
   marks the item `assigned`. **Idempotent** — if the email is already a
   source on that case it's a no-op (no duplicate); the route reports
   `created` vs `alreadyPresent`.
4. **Ignore** (`POST …/triage/[id]/ignore`) — marks `ignored`; won't
   resurface on re-sync.

Suggestions are decision support — the lawyer always confirms. POC limits:
25-message sync window, synchronous suggestion, and the per-case pull /
triage don't yet cross-dedupe *which messages appear* (the source-level
idempotency means no duplicates either way; a message already pulled can
still show in triage — just Ignore it).

### File map

| Path | What lives here |
|---|---|
| `src/middleware.ts` | Auth.js fence — redirects unauthenticated requests to `/sign-in`. |
| `src/auth.ts` + `src/auth.config.ts` | Auth.js (NextAuth v5): Microsoft Entra provider, Drizzle adapter, JWT sessions. Split config (edge-safe vs adapter). |
| `src/app/sign-in/page.tsx` + `src/app/api/auth/[...nextauth]/` | Sign-in page + Auth.js route handler. |
| `src/lib/auth.ts` | `getCurrentUserId()` — fence stand-in until real auth. |
| `src/app/` | Routes. `cases/layout.tsx` owns the sidebar; `cases/[id]/page.tsx` the detail view. |
| `src/components/cases/` | `CaseSidebar`, `CaseTabs` (Overview / Sources / Tools), `AddNoteButton`, `UploadButton`, `PasteButton`, `SourceActions`, `RegenerateSummaryButton`, `NewCaseButton`, `DeleteCaseButton`, `ToolRunner`, `OutlookCaseActions`. Client components for URL-state, source ingestion, summaries, case create/delete, tool runs, and Outlook connect/pull. |
| `src/components/settings/OutlookSettings.tsx` + `src/app/settings/` | Settings page: connected mailbox + connect/disconnect. |
| `src/components/triage/` + `src/app/triage/` | Mailbox triage: `/triage` page, `TriageList` / `TriageRow`. |
| `src/app/api/integrations/outlook/{disconnect,triage/sync,triage/[id]/assign,triage/[id]/ignore}/route.ts` | Disconnect + triage sync / assign / ignore. |
| `src/components/layout/Header.tsx` | Palamedes top bar. |
| `src/data/cases.ts` | View-model types + display labels (`CASE_TYPE_LABEL` etc.). _No data here any more_ — name is historical. |
| `src/lib/cases/queries.ts` | Owner-scoped case + client queries, plus the view-model mapper that calls into `sources/queries.ts`. |
| `src/lib/sources/queries.ts` | Owner-scoped `listSourcesForCase` + DB→view mapper. |
| `src/lib/sources/summarize.ts` | `summarizeNote` / `summarizeFile` / `summarizePastedMessage` / `summarizeCase` — Haiku 4.5 calls with the UK-immigration system prompts. |
| `src/lib/sources/process.ts` | `summarizeSource(row)` — re-summarize dispatch by kind, used by the retry route. |
| `src/lib/generations/queries.ts` | Owner-scoped `listGenerationsForCase` (+ message threads) → view-model. |
| `src/lib/tools/registry.ts` | In-code tool registry (id/label/system prompt/`buildUserPrompt`). |
| `src/lib/tools/context.ts` | `buildToolContext` — assembles Opus input from case + selected source summaries. |
| `src/lib/tools/stream.ts` | `streamGeneration` — shared Opus 4.8 NDJSON streamer; persists the turn + status. |
| `src/lib/outlook/oauth.ts` | MS identity OAuth — authorize URL / code exchange / refresh (delegated). |
| `src/lib/outlook/graph.ts` | Graph client — `getConnectedEmail`, `listMessagesForEmail` (+ HTML→text). |
| `src/lib/outlook/tokens.ts` | Owner-scoped token store — save / `getConnection` / `getValidAccessToken` (auto-refresh). |
| `src/lib/outlook/crypto.ts` | AES-256-GCM encrypt/decrypt for stored tokens (`MS_TOKEN_ENC_KEY`). |
| `src/lib/outlook/graph.ts` (cont.) | also `listRecentMessages` + `getMessageById` (triage sync / assign). |
| `src/lib/sources/fromEmail.ts` | `createEmailSourceFromOutlook` — shared, idempotent email→source (pull + triage assign). |
| `src/lib/triage/suggest.ts` | `suggestCaseForMessage` — Haiku forced-tool case suggestion. |
| `src/lib/triage/queries.ts` | `listPendingTriage` / `listCaseOptions` / `countPendingTriage`. |
| `src/lib/anthropic.ts` | Shared Anthropic SDK client + `MODELS` table (Haiku 4.5 / Opus 4.8). Server-only. |
| `src/lib/blob.ts` | Vercel Blob wrapper (`uploadSourceFile`, `access: 'private'`). Server-only. |
| `src/app/cases/actions.ts` | `revalidateCases()` server action — post-mutation re-render (replaces `router.refresh()`). |
| `src/app/api/sources/notes/route.ts` | `POST` handler for note creation (Zod validation, ownership check, Haiku call). |
| `src/app/api/sources/upload/route.ts` | `POST` multipart handler — Blob + Files API + Haiku summary. |
| `src/app/api/sources/paste/route.ts` | `POST` handler for pasted email / WhatsApp (Zod, ownership check, metadata, Haiku call). |
| `src/app/api/sources/[id]/route.ts` | `DELETE` a source (owner-scoped). |
| `src/app/api/sources/[id]/retry/route.ts` | `POST` — re-run the Haiku summary for a source. |
| `src/app/api/cases/route.ts` | `POST` — create a case (+ inline client). |
| `src/app/api/cases/[id]/route.ts` | `DELETE` a case (owner-scoped; cascades sources + generations). |
| `src/app/api/cases/[id]/summary/route.ts` | `POST` — regenerate the AI case summary (Haiku rollup). |
| `src/app/api/generations/route.ts` | `POST` — run a tool; streams an Opus 4.8 draft as NDJSON. |
| `src/app/api/generations/[id]/messages/route.ts` | `POST` — chat-on-generation refine; re-streams with the thread. |
| `src/app/api/generations/[id]/edit/route.ts` | `POST` — save a manual edit of the current draft. |
| `src/app/api/integrations/outlook/connect/route.ts` | `GET` — start OAuth (CSRF state cookie → MS consent). |
| `src/app/api/integrations/outlook/callback/route.ts` | `GET` — OAuth callback: exchange code, store encrypted tokens, revalidate. |
| `src/app/api/cases/[id]/pull-outlook/route.ts` | `POST` — pull the client's emails via Graph → dedupe → `email` sources. |
| `src/db/schema.ts` | Drizzle tables (`clients`, `cases`, `sources`, `generations`, `generation_messages`, `integration_tokens`), const tuples for enums, CHECK constraints. |
| `src/db/db.ts` | Drizzle client over Neon HTTP. Re-exports `schema`. |
| `src/db/migrations/` | Generated SQL (one file per migration) + meta. |
| `drizzle.config.ts` | drizzle-kit config; uses unpooled URL for DDL. |
| `scripts/seed-dev.mjs` | TRUNCATE-and-reseed dev fixture (3 clients + 4 cases + 7 notes + 3 pasted messages). |
| `scripts/verify-db.mjs` | Post-migration sanity check (lists tables + columns). |

### Tech stack at a glance

- **Frontend:** Next 14 App Router · React 18 · TypeScript · Tailwind + DaisyUI (corporate theme) · Lucide icons.
- **State / network:** Server components for most pages; SWR + NDJSON streaming for chat-on-generation (when it lands).
- **DB:** Neon Postgres · Drizzle ORM · `@neondatabase/serverless` HTTP driver.
- **AI:** `@anthropic-ai/sdk` · Haiku 4.5 (summaries) · Opus 4.8 (tool drafts).
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
| `external_id` | text | NULL | external source id (Graph message id) — dedup key for integration-pulled sources; null for manual ones |
| `created_at`, `updated_at` | timestamptz | NOT NULL | default `now()` |

Indexes: `sources_case_id_idx (case_id)`, `sources_owner_id_idx (owner_id)`, `sources_status_idx (status)`, `sources_case_external_idx (case_id, external_id)`. The status index is cheap and ready for the future "find all `queued` sources to process" worker; the case-external index backs the Outlook pull's dedup lookup.

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

#### `generations` + `generation_messages`

For the Tools tab (Opus 4.8 drafts + chat-on-generation). Each tool run
is a `generation` (`tool_id` references the in-code registry, `version`
is per-(case, tool), `status` ∈ `running|complete|failed`, `model`);
each turn is a `generation_message` (`role` ∈ `user|assistant`,
`content`). Cascade FKs: `cases` → `generations` → `generation_messages`.
Migration 0003.

Also on `cases` (migration 0002): `ai_summary` / `ai_summary_model` /
`ai_summary_generated_at` — the AI case summary, alongside the
lawyer-authored `summary`.

#### `integration_tokens`

OAuth tokens for connected integrations (Outlook first). Migration 0004.
One row per `(owner_id, provider)` — unique index, the upsert target.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | — | PK, default `gen_random_uuid()` |
| `owner_id` | text | NOT NULL | |
| `provider` | text | NOT NULL | CHECK IN (`'outlook'`) |
| `access_token` | text | NOT NULL | **AES-256-GCM encrypted** at rest |
| `refresh_token` | text | NULL | encrypted; absent if the provider returned none |
| `expires_at` | timestamptz | NULL | access-token expiry (drives auto-refresh) |
| `scope` | text | NULL | granted scopes |
| `account_email` | text | NULL | the connected mailbox (shown in the UI) |
| `created_at`, `updated_at` | timestamptz | NOT NULL | default `now()` |

Unique index: `integration_tokens_owner_provider_idx (owner_id, provider)`.
Plaintext tokens never hit the DB — encrypt/decrypt is `src/lib/outlook/crypto.ts`
keyed by `MS_TOKEN_ENC_KEY`.

#### `mailbox_messages`

Triage candidates (migration 0005) — recent mailbox messages before
they're committed to a case. `owner_id`, `provider`, `external_id`
(Graph id) + `conversation_id`, `from_address`/`from_name`, `subject`,
`received_at`, `snippet`, `status` ∈ `pending|assigned|ignored`,
`assigned_case_id` / `suggested_case_id` (FK → cases, SET NULL on
delete), `suggestion_reason`. Unique `(owner_id, external_id)`; indexes
on `(owner_id, status)` and `(owner_id, conversation_id)`. A row becomes
a `source` only when assigned.

---

## 3. What's outstanding

### Phase A.1 — done

Phase A.1 is feature-complete: DB-backed cases, the full source
lifecycle (note / upload / paste ingestion + delete + retry), AI case
summaries, case creation, and the Tools tab (Opus 4.8 drafts with
chat-on-generation). Remaining A.1 polish, none blocking:

- **Apply migrations 0002 + 0003** to Neon (`npx drizzle-kit migrate`)
  and run the dev verification pass end to end against a live
  `ANTHROPIC_API_KEY`.
- **Retry fidelity for text sources.** Retry re-summarizes from the
  stored `content_preview` (300 chars), not the full body — a
  `raw_content` column would make note/paste retries exact.
- **Generation history.** `ToolRunner` now has a "View" button that
  re-opens the latest generation's draft + thread (read from
  `caseData.generations`, no fetch) and lets you keep refining it. Not
  yet exposed: browsing *all* past versions of a tool (only the latest
  is reachable) — a version list would need a small UI addition.
- **More tools** beyond the first two; move the registry to a richer
  structure as it grows.
- **Collapsible sidebar** (`?sidebar=hidden`) confirmed working.

### Phase A.2 — inbound channels

- **Outlook (Microsoft Graph): DONE.** Per-case **pull** (merged, PR #5)
  + **triage inbox with AI suggestions** (`feat/email-triage`). See §2.
  Remaining Outlook polish: pagination / time-window on large mailboxes;
  background (async) summarisation + suggestion; cross-dedupe the
  per-case pull and triage (which messages appear); and eventually a
  **change-notification webhook** for continuous sync (needs a public
  HTTPS endpoint → a deploy).
- **WhatsApp Business sandbox webhook.** Verify, parse, route to the
  right case (by phone number lookup against `clients.phone`), create
  a `source` row.
- **Routing rules — partly done.** The triage inbox is the manual /
  AI-assisted routing path. Still open: a **per-case email alias**
  (forward/BCC routing) and conversation-first auto-pull as power-user
  shortcuts.

### Phase B — solicitor-grade polish

- More tools — cover letters for ILR, Naturalisation, Family Visa
  variants; appeal grounds variants.
- Deadlines view (calendar / list) with reminders.
- **Bundle PDF export** — assemble the case bundle for tribunals.
- **Real auth — IN PROGRESS** (`feat/auth`, see `plan-auth.md`). Chose
  **Auth.js (NextAuth v5)** with the **Drizzle adapter** — users live in
  *our own Postgres* (portable across DB providers, no vendor; the key
  reason over Clerk/Neon Auth given a possible future move off Neon).
  **"Sign in with Microsoft"** (Entra — natural M365 fit; the Outlook
  Azure app can host sign-in too via the `/api/auth/callback/microsoft-entra-id`
  redirect URI). JWT sessions; middleware replaces the Basic Auth fence;
  `getCurrentUserId()` reads `session.user.id`. `owner_id: text` already
  holds the user id — no change to existing tables. `scripts/claim-fence-data.mjs`
  reassigns the old `fence-user` data to a real user. Migration 0006
  (auth tables) + AUTH_* env + the Azure redirect URI to apply.
- **Firm/team sharing** — multiple solicitors sharing cases via an
  `org_id`/membership layer. Out of scope for v1 auth (per-user
  isolation); the next phase. Client portals still out of scope.

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
