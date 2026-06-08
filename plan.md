# Outlook (Microsoft Graph) integration — POC plan

Phase A.2, first channel. **Pull-on-demand only** — no cron, no webhooks
yet. Each case gets a **"Pull from Outlook"** button that fetches emails
to/from the case client's email address, creates `email` source rows,
and Haiku-summarises them (the same pipeline as pasted email).

---

## 1. How it will work (architecture)

- **Delegated OAuth.** The solicitor (beta user) connects *their own*
  Outlook mailbox once. We get an access token + refresh token and read
  their mail via Microsoft Graph. No admin-wide app permissions, no
  reading anyone else's mailbox.
- **Pull, per case.** A button on the case detail page calls a route
  that:
  1. looks up the case's client email (`clients.email`),
  2. gets a valid Graph access token (refreshing if expired),
  3. queries Graph `/me/messages` for messages where that email is a
     participant (from / to / cc),
  4. for each new message → inserts a `source` (kind `email`,
     metadata `from`/`subject`, `source_received_at` = receivedDateTime,
     `content_preview` from the body) → Haiku summary via the existing
     `summarizePastedMessage`,
  5. **dedups** on the Graph message id so re-pulling doesn't duplicate.
- **Reuses everything we already have**: the source lifecycle
  (`processing → ready/failed`), `summarizePastedMessage`, and
  `revalidateCases()` for the post-action refresh.
- **No background monitoring.** The lawyer pulls when they want fresh
  mail. Cron / Graph change-notification webhooks are a later phase
  (and need a public HTTPS endpoint = a Vercel deploy first).

---

## 2. External setup (Azure Portal — one-time, do this first)

In **Entra ID (Azure AD) → App registrations**:

1. **New registration**
   - Name: `Palamedes (dev)` (or similar).
   - Supported account types: **Accounts in any organizational
     directory** (`organizations`) is the safe default for work/school
     M365 mailboxes. Use **"any org directory and personal Microsoft
     accounts"** (`common`) only if a beta user is on a personal
     Outlook.com account. _Decision needed — see §6._
   - Redirect URI (type **Web**):
     - dev: `http://localhost:3000/api/integrations/outlook/callback`
     - prod (after deploy): `https://<vercel-domain>/api/integrations/outlook/callback`
2. **API permissions → Add → Microsoft Graph → Delegated**:
   - `Mail.Read` (read the user's mail)
   - `offline_access` (refresh tokens)
   - `User.Read` (basic profile / the connected account email)
   - Click **Grant admin consent** if you have the rights; otherwise the
     user consents at first sign-in (if the tenant allows user consent).
3. **Certificates & secrets → New client secret** → copy the **Value**
   (shown once).
4. Copy from the **Overview** page: **Application (client) ID** and
   **Directory (tenant) ID**.

---

## 3. Environment variables (add to `.env.local`, and Vercel later)

```
MS_CLIENT_ID=<Application (client) ID>
MS_CLIENT_SECRET=<client secret value>
MS_TENANT=organizations           # or 'common', or a specific tenant id
MS_REDIRECT_URI=http://localhost:3000/api/integrations/outlook/callback
# Optional: a 32-byte key to encrypt stored tokens at rest (see §6)
# MS_TOKEN_ENC_KEY=<base64 32 bytes>
```

Add a documented placeholder block to `.env.example` too.

---

## 4. What to tell the beta test user

> **Connecting your Outlook mailbox to Palamedes**
>
> 1. You'll need a Microsoft 365 / Outlook (work or school) account —
>    the one that receives your client correspondence.
> 2. In Palamedes, click **Connect Outlook** and sign in with that
>    account.
> 3. Approve the permission request — Palamedes asks only to **read your
>    mail** (`Mail.Read`). It cannot send, delete, or change anything.
> 4. If your IT admin restricts third-party apps, the sign-in may say
>    "approval required" — forward the request to your admin, or ask
>    them to grant consent for Palamedes once.
> 5. Once connected, open any case and click **Pull from Outlook**.
>    Palamedes finds emails to/from that client's email address, imports
>    them as sources, and summarises each one.
>
> **Privacy:** Palamedes reads only messages that match the client's
> email on the case, stores those messages and their summaries in the
> Palamedes database (behind the login fence), and never sends anything
> from your mailbox. You can disconnect at any time. _(POC — review the
> data-handling note before using real client data.)_

---

## 5. Implementation plan (tomorrow)

### DB (migration 0004)
- **`integration_tokens`** table: `id`, `owner_id`, `provider`
  (`'outlook'`), `access_token`, `refresh_token`, `expires_at`,
  `scope`, `account_email`, `created_at`/`updated_at`. One row per
  (owner, provider) for now (single fence user). Unique index on
  (owner_id, provider).
- **Dedup**: add `external_id text` to `sources` (the Graph message id)
  + index on (case_id, external_id). On pull, skip messages whose
  `external_id` already exists for the case.

### Lib
- `src/lib/outlook/oauth.ts` — build the authorize URL, exchange code
  for tokens, refresh tokens. Uses `MS_*` env.
- `src/lib/outlook/graph.ts` — `listMessagesForEmail(token, email)` →
  calls Graph `/me/messages` (`$search`/`$filter` by participant,
  `$select` id/subject/from/toRecipients/receivedDateTime/bodyPreview/body,
  `$top`), returns a normalized shape ready for source insert.
- `src/lib/outlook/tokens.ts` — load/save tokens (owner-scoped), and a
  `getValidAccessToken()` that refreshes when expired. (Encrypt at rest
  if we add `MS_TOKEN_ENC_KEY`; else store plaintext + a TODO.)

### Routes
- `GET /api/integrations/outlook/connect` → 302 to the Microsoft
  authorize URL (state + scope `Mail.Read offline_access User.Read`).
- `GET /api/integrations/outlook/callback` → exchange `code`, store
  tokens + `account_email`, redirect back to the app.
- `GET /api/integrations/outlook/status` → `{ connected, accountEmail }`
  for the UI.
- `POST /api/cases/[id]/pull-outlook` → ownership check → resolve client
  email → pull → insert+summarise new messages → return `{ imported }`.

### UI
- **Connect Outlook** affordance (header or a small settings area):
  shows "Connect Outlook" or "Connected as <email>".
- **Pull from Outlook** button on the case detail header (next to
  Delete): disabled if not connected or the client has no email;
  loading state; on success show a count and `revalidateCases()`.
- If the client has no email, prompt the lawyer to add one.

### Reuse
- `summarizePastedMessage({ kind: 'email', ... })` for summaries.
- `revalidateCases()` for the refresh.
- Source status lifecycle (`processing → ready/failed`).

---

## 6. Decisions / open questions (resolve before/while building)

- **Tenant scope**: `organizations` (work/school only) vs `common`
  (also personal Outlook.com). Depends on the beta user's account type.
- **Token encryption at rest**: POC plaintext-in-DB (+ TODO) vs a small
  AES-GCM with `MS_TOKEN_ENC_KEY`. Recommend the env-key encryption
  even for POC since these are mailbox tokens.
- **Query scope**: from OR to/cc the client; how many (`$top`, e.g. 50);
  any time window (e.g. last 12 months) to bound the first pull.
- **Body handling**: store `bodyPreview` vs full `body` (HTML→text).
  Likely strip to text and cap length for the summary + preview.
- **Consent**: will the beta user's org allow user consent, or do we
  need admin consent? (Affects the "what to tell the user" step.)

---

## 7. Verification (end of tomorrow)

1. Azure app registered; `MS_*` env set locally.
2. **Connect** flow round-trips: sign in → callback stores a token row
   with `account_email`.
3. On a case whose client email matches real mail, **Pull from Outlook**
   imports messages as `email` sources, each Haiku-summarised.
4. **Pull again** → no duplicates (dedup by `external_id`).
5. Token **refresh** works after the access token expires.
