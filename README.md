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

# .env.local — required vars:
cat > .env.local <<'EOF'
ANTHROPIC_API_KEY=sk-ant-...     # console.anthropic.com (not a Claude Pro sub)
BASIC_USER=admin                 # HTTP Basic Auth fence — pick anything
BASIC_PASS=admin
EOF

npm run dev                      # http://localhost:3000
```

The browser will pop a native auth dialog on first visit — enter the
`BASIC_USER` / `BASIC_PASS` you set above.

## What's here today

Foundations only — Next 14 App Router, TypeScript, Tailwind + DaisyUI
(corporate theme), Biome for lint/format, HTTP Basic Auth fence, an
app shell with the Palamedes header, and a landing page that CTAs
"Add your first case".

## What's coming next

| Phase | Scope |
|---|---|
| **A.1** | Clients + cases + Sources (manual upload + add note + manual email/WhatsApp paste) + per-source Haiku summaries + case summary + 2 starter tools (Client Care Letter, Spouse Visa Cover Letter) + chat-on-generation + collapsible sidebar |
| **A.2** | WhatsApp Business sandbox webhook + Outlook (Microsoft Graph) webhook + routing inbound messages to cases |
| **B** | More tools, deadlines, Bundle PDF export, real auth |

Sibling project [`compliance-assistant`](../compliance-assistant) shares
its pattern library — SWR-driven UI, NDJSON streaming, Vercel Blob
private uploads, Anthropic Files API for documents.

Stack: Next.js 14 · TypeScript · Tailwind + DaisyUI · `@anthropic-ai/sdk`.
