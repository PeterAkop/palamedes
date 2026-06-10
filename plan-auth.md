# Auth & multi-user (Auth.js / NextAuth v5) — plan

Phase C. Replace the single shared Basic Auth fence with **real per-user
auth**, so each solicitor logs in and sees only their own cases, sources,
generations, mailbox, and triage. Self-hosted with **Auth.js (NextAuth
v5) + the Drizzle adapter** — users live in *our* Postgres, portable
across DB providers (Neon → RDS → self-hosted), no vendor lock-in.

The data layer is already multi-user-ready: every table has `owner_id:
text`, scoped via `getCurrentUserId()`. This is a **concentrated swap**,
not a rewrite — the work is auth wiring + making `getCurrentUserId()`
return the session user.

---

## 1. Why Auth.js (recap)

- **Self-owned, DB-portable.** Users/accounts/sessions are plain Postgres
  tables via `@auth/drizzle-adapter`; they move with the database. No
  external user store.
- **Next.js App Router native** (Auth.js v5), Vercel-friendly.
- **Free**, no vendor.
- Trade-off: most wiring of the options (we build the sign-in UI +
  configure providers/adapter/middleware).

---

## 2. Architecture

- **`next-auth@beta` (v5)** + **`@auth/drizzle-adapter`**.
- **Adapter tables** (migration 0006), standard Auth.js schema in our DB:
  `users`, `accounts`, `sessions`, `verification_tokens`. Defined in
  `src/db/schema.ts` (Drizzle) so they're owned + migratable like the rest.
- **Session strategy: JWT** (stateless) — best on Vercel serverless (no
  per-request session-table read). The adapter still persists users +
  accounts; the JWT carries the user id.
- **`src/auth.ts`** — the Auth.js config: adapter, providers, session
  strategy, and a `session` callback that puts `user.id` on the session
  so `getCurrentUserId()` can read it.
- **`getCurrentUserId()` becomes async** — `const session = await auth();
  if (!session?.user?.id) throw/redirect; return session.user.id`. This
  is the single integration point; everything downstream is already
  owner-scoped.
- **Middleware** — replace the Basic Auth fence (`src/middleware.ts`) with
  Auth.js middleware: protect all app routes, redirect unauthenticated
  users to `/sign-in`. Keep the OAuth callback + static assets public.
- **`owner_id`** keeps referencing the user id (now `users.id`) — no
  schema change to existing tables.

---

## 3. Login method (decision — see §6)

Auth.js needs at least one provider. Options:

- **Microsoft Entra (recommended)** — "Sign in with your Microsoft work
  account". Natural fit: solicitors are on M365, and we already have an
  Azure app from the Outlook work (sign-in is a *separate* scope from the
  Outlook `Mail.Read` mailbox connection, but the same Entra tenant/app
  registration can host both). One identity for login.
- **Google** — easy, ubiquitous; good as a second option.
- **Email magic link** — passwordless; needs an email sender (Resend/SMTP).
- **Credentials (email + password)** — most control, but we own password
  hashing (bcrypt/argon2), reset flows, etc. — most work + most footguns.

Recommend: **Microsoft Entra** (+ optionally Google). Avoid Credentials
unless email/password is a hard requirement.

---

## 4. Work breakdown (slices)

1. **Adapter + config.** Install `next-auth@beta`, `@auth/drizzle-adapter`.
   Add the four Auth.js tables to `schema.ts` (migration 0006). Write
   `src/auth.ts` (provider(s), Drizzle adapter, JWT session, `session`
   callback exposing `user.id`). Env: provider client id/secret +
   `AUTH_SECRET`.
2. **`getCurrentUserId()` → async.** Swap the constant for the session
   lookup, then **sweep every call site to `await`** it. All callers are
   server-side (route handlers + `src/lib/**/queries.ts` + server
   components) and mostly already `async` — mechanical but broad (see §5).
3. **Middleware swap.** Replace the fence with Auth.js middleware; protect
   routes; allow `/sign-in`, the OAuth callback, and static assets.
4. **UI.** `/sign-in` page (Auth.js sign-in for the chosen provider),
   sign-out, and a user indicator (avatar/email + sign-out) in the header
   replacing nothing — added next to Cases/Triage/Settings.
5. **Existing `fence-user` data.** Decide: (a) reseed fresh, or (b) a
   one-time script reassigning all `owner_id = 'fence-user'` rows to a
   chosen real user id after first sign-in. (POC: probably reseed.)
6. **Remove the fence.** Drop `BASIC_USER` / `BASIC_PASS` and the fence
   logic once auth works.
7. **Verify** (see §7).

---

## 5. The `getCurrentUserId()` async sweep

`getCurrentUserId()` is imported across the server code — every owner-
scoped query and route. Making it async means adding `await` at each
call site. Representative locations:

- `src/lib/cases/queries.ts`, `src/lib/sources/queries.ts`,
  `src/lib/generations/queries.ts`, `src/lib/triage/queries.ts`,
  `src/lib/outlook/tokens.ts` (via callers).
- Every `src/app/api/**/route.ts` handler.
- Server components: `src/app/cases/**`, `src/app/settings/page.tsx`,
  `src/app/triage/page.tsx`, `src/components/layout/Header.tsx`.

It's a find-all-usages → add-`await` pass; `tsc` will flag any missed
site (calling an async fn without await → type error on the result).

---

## 6. Decisions / open questions

- **Provider(s)** — Microsoft Entra (rec) / Google / magic link /
  credentials. (Microsoft = best M365 fit + reuses the Azure registration.)
- **Session** — JWT (rec) vs database sessions.
- **`fence-user` data** — reseed vs migrate-to-first-user.
- **Scope of "multi-user"** — per-user isolation now (owner = individual).
  **Firm/team sharing** (multiple solicitors, shared cases via an
  `org_id`/membership layer) is explicitly **out of scope for v1** — note
  it as the next phase; `owner_id` stays per-user until then.
- **Keep the fence during transition?** Optionally keep Basic Auth as an
  outer layer in dev until Auth.js is solid, then remove.

---

## 7. Verification

1. Migration 0006 applied (Auth.js tables).
2. Sign in as **User A** → create cases / connect Outlook / triage. Sign
   out, sign in as **User B** → sees **none** of A's data; own mailbox
   connection is independent.
3. `owner_id` on new rows = the real user id (not `fence-user`).
4. Outlook connect + triage + tool generation all work per-user.
5. Unauthenticated access redirects to `/sign-in`; the fence is gone.
