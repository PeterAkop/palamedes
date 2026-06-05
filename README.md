# Palamedes

AI-assisted casework for **UK immigration solicitors**. Drop in WhatsApp
chats, emails, scanned documents, manual notes — Palamedes summarises
each source, builds a case overview, and generates the cover letters,
client care letters, and appeal grounds the lawyer would otherwise
hand-write in ChatGPT.

> Decision support, not legal advice. The intended workflow is **AI
> drafts → solicitor reviews and edits → solicitor signs and files.**

## Quick start

```bash
npm install

# .env.local — see .env.example for the full annotated list. At minimum:
#   ANTHROPIC_API_KEY     — console.anthropic.com (not a Claude Pro sub)
#   BASIC_USER / BASIC_PASS — HTTP Basic Auth fence (pick anything)
#   DATABASE_URL          — Neon pooled connection string
#   DATABASE_URL_UNPOOLED — Neon direct connection (drizzle-kit migrate)
# Easiest path for the DB: Vercel Storage → Neon → copy both URLs.

npm run db:migrate               # apply Drizzle migrations to Neon
node scripts/seed-dev.mjs        # seed 3 sample clients + 4 cases (dev only)
npm run dev                      # http://localhost:3000
```

The browser will pop a native auth dialog on first visit — enter the
`BASIC_USER` / `BASIC_PASS` you set above.

## Project state

See [`STATUS.md`](./STATUS.md) for the current snapshot — what's done,
how the app is meant to work end to end, and what's still to build.
Updated after each meaningful slice lands.

High-level roadmap (kept in STATUS.md too, but the headlines):

| Phase | Scope |
|---|---|
| **A.1** | Clients + cases + Sources (manual upload + add note + manual email/WhatsApp paste) + per-source Haiku summaries + case summary + 2 starter tools (Client Care Letter, Spouse Visa Cover Letter) + chat-on-generation + collapsible sidebar |
| **A.2** | WhatsApp Business sandbox webhook + Outlook (Microsoft Graph) webhook + routing inbound messages to cases |
| **B** | More tools, deadlines, Bundle PDF export, real auth |

Sibling project [`compliance-assistant`](../compliance-assistant) shares
its pattern library — SWR-driven UI, NDJSON streaming, Vercel Blob
private uploads, Anthropic Files API for documents.

Stack: Next.js 14 · TypeScript · Tailwind + DaisyUI · Neon + Drizzle ·
`@anthropic-ai/sdk`.
