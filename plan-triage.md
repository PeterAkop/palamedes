# Email → case routing: triage inbox with AI suggestions — spec

Phase A.2, second slice. Solves the limitation of the per-case Outlook
pull (address-only matching: misses self-forwards / threads where the
client isn't on the latest reply / internal notes, and can over-match).

**Approach:** a **mailbox triage inbox** — pull *recent* messages from the
connected mailbox (not filtered to one client), have Haiku **suggest the
likely case** for each, and let the lawyer **assign** (one click on the
suggestion, or pick another case) or **ignore**. The existing per-case
"Pull from Outlook" button stays as the fast path when the client email
is clean; triage handles the messy rest.

Everything stays `owner_id`-scoped → multi-user-ready (each user triages
only their own mailbox into their own cases).

---

## 1. How it works

1. **Sync** — pull the N most-recent mailbox messages (Graph, ordered by
   date, *not* `$search`-filtered). New ones (by message id) become
   `pending` triage items with from / subject / date / snippet /
   `conversationId`.
2. **Suggest** — for each new pending item, Haiku picks the best-matching
   case among the owner's cases (by client name/email + case summary) and
   returns a case id + one-line reason, stored on the item.
3. **Triage** — the lawyer reviews the list. Per item:
   - **Assign** to the suggested case (one click), or pick a different
     case from a dropdown → creates an `email` source on that case
     (reusing the pull's insert + Haiku summary), tagged
     `origin: 'outlook'`. Optionally **assign the whole thread**
     (all pending items sharing the `conversationId`).
   - **Ignore** → item is marked `ignored`, won't resurface.
4. **Dedup / no resurfacing** — items are keyed on `(owner, message id)`;
   re-syncing skips any message already tracked (pending/assigned/ignored)
   or already imported as a source.

---

## 2. Data model (migration 0005)

New table **`mailbox_messages`** — triage candidates (distinct from
`sources`, which are *committed* case material; a triage item only
becomes a source when assigned).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `owner_id` | text | NOT NULL |
| `provider` | text | CHECK IN (`'outlook'`) |
| `external_id` | text | Graph message id |
| `conversation_id` | text | Graph `conversationId` — thread grouping |
| `from_address` / `from_name` | text | sender |
| `subject` | text | |
| `received_at` | timestamptz | |
| `snippet` | text | `bodyPreview` (full body fetched on assign, not stored) |
| `status` | text | CHECK `pending` / `assigned` / `ignored`, default `pending` |
| `assigned_case_id` | uuid | FK → `cases(id)` ON DELETE SET NULL, nullable |
| `suggested_case_id` | uuid | Haiku's suggestion, nullable |
| `suggestion_reason` | text | one-line why, nullable |
| `created_at` / `updated_at` | timestamptz | |

Indexes: unique `(owner_id, external_id)` (dedup/upsert), `(owner_id, status)`
(the triage list), `(owner_id, conversation_id)` (thread assign).

`MAILBOX_STATUSES = ['pending','assigned','ignored']` const tuple.

---

## 3. Lib / reuse

- **`src/lib/outlook/graph.ts`** — add `listRecentMessages(token, top)`
  (`/me/messages?$top=N&$orderby=receivedDateTime desc&$select=…`,
  including `conversationId`) and `getMessageById(token, id)` (full body
  on assign).
- **`src/lib/sources/fromEmail.ts`** (new, factored) —
  `createEmailSource({ caseId, ownerId, message })`: the insert +
  `summarizePastedMessage` + ready/failed update, shared by the per-case
  pull *and* triage-assign (DRY the duplication now in `pull-outlook`).
- **`src/lib/triage/suggest.ts`** (new) — `suggestCaseForMessage(message,
  cases)`: Haiku with structured output (a tool / JSON schema returning
  `{ caseId | null, reason }`) given the message + a compact list of the
  owner's cases (id, client name + email, type, short summary). Batched
  per sync.
- **`src/lib/triage/queries.ts`** (new) — owner-scoped
  `listPendingTriage()` (+ the suggested case joined for display),
  insert/update helpers.

---

## 4. Routes

- `POST /api/integrations/outlook/triage/sync` — pull recent → upsert new
  pending items → run suggestions → return `{ added }`.
- `POST /api/integrations/outlook/triage/[id]/assign` — body
  `{ caseId, includeThread? }`: ownership checks → fetch full message →
  `createEmailSource` → mark `assigned` (+ thread items if requested) →
  revalidate.
- `POST /api/integrations/outlook/triage/[id]/ignore` — mark `ignored`.
- (Owner-scoped throughout; behind the fence.)

---

## 5. UI

- **`/triage` page** (server component) — lists pending items: from,
  subject, date, snippet, a **suggested-case badge** + reason. Per row:
  **Assign** (to the suggestion) / a **case picker** dropdown / **Ignore**,
  and "assign whole thread" when siblings share a conversation.
- **`TriageList` / `TriageRow`** client components — actions call the
  routes, then `revalidateTriage()` server action (same staleTimes-proof
  refresh pattern as `revalidateCases`).
- **Header**: a **Triage** link with a **pending-count badge** next to
  Settings.
- Empty state when nothing pending ("Sync your mailbox").

---

## 6. AI suggestion details

- Input to Haiku: the message (from, subject, snippet) + the owner's cases
  as `[{ caseId, client: "Name <email>", type, summary(≤200 chars) }]`.
- Output (structured): `{ caseId: string | null, reason: string }` — null
  when nothing is a confident match (lawyer picks manually).
- Cost: one Haiku call per new message per sync (cap the sync batch, e.g.
  50). If a tenant has many cases, pre-filter candidates by cheap signals
  (email participant / surname in subject) before sending to Haiku.
- It's a **suggestion only** — never auto-assigns; the lawyer always
  confirms. Decision support, not automation.

---

## 7. Decisions / open questions

- **Sync window**: most-recent 50 messages (POC). Later: "since last sync"
  / a date range / pagination.
- **Suggestion candidate set**: all of the owner's non-closed cases, with
  a pre-filter if the list is large.
- **Full body**: fetched on assign (keeps the triage table lean) — one
  extra Graph call per assign. Acceptable.
- **Thread assign**: opt-in per assign (checkbox), not automatic.
- **Relationship to per-case pull**: both stay. The per-case pull could
  later also drop its matches into triage instead of straight to sources —
  out of scope for v1.

---

## 8. Verification

1. Migration 0005 applied; `MS_*` connected.
2. **Sync** → pending items appear with sensible **AI suggestions** (e.g.
   the Daniel Okafor emails → the spouse-visa case).
3. **Assign** a suggested item → an `email` source (Outlook badge) appears
   on that case, summarised; the item leaves the triage list.
4. **Ignore** an item → gone, doesn't return on re-sync.
5. **Thread assign** → all messages in the conversation import together.
6. Re-sync → no duplicates (assigned/ignored stay gone).
