# Palamedes

An AI-assisted case-management and document-generation prototype for UK immigration solicitors.

Palamedes explores how AI can support complex professional workflows involving large amounts of unstructured information — emails, WhatsApp conversations, documents and case notes — while keeping the solicitor in control of the final output.

The project was built as an AI-assisted product prototype and used to explore real-world legal casework workflows.

## What it does

- Organises clients, cases and case-related source material
- Accepts documents, notes, emails and pasted conversations
- Uses AI to summarise individual sources and build structured case context
- Generates draft legal documents from case information
- Supports iterative chat around generated documents
- Integrates with Microsoft Outlook / Graph workflows
- Handles file storage and document processing
- Uses background jobs for longer-running AI workflows
- Generates PDF outputs

The intended workflow is:

**case sources → structured context → AI-assisted draft → solicitor review and editing → final document**

Palamedes is decision-support software and does not provide legal advice.

## Architecture

The application is built around a Next.js frontend and server layer, with structured data stored in PostgreSQL and larger files stored separately.

AI workflows combine case context, uploaded material and structured prompts to produce summaries and document drafts.

Longer-running operations are handled asynchronously so the UI does not need to block while AI or document-processing tasks complete.

## Tech stack

- Next.js
- React
- TypeScript
- Tailwind CSS / DaisyUI
- PostgreSQL / Neon
- Drizzle ORM
- Anthropic API
- Auth.js
- Microsoft Graph
- Vercel Blob
- Inngest
- SWR
- PDF generation

## AI-assisted development

Palamedes was developed extensively using AI-assisted engineering workflows.

AI agents were used for implementation, code exploration, refactoring and development planning, while architecture, product behaviour, workflow design and technical decisions were iterated through hands-on development and testing.

The project was intentionally used to explore how far modern AI-assisted development can accelerate building a substantial product prototype.

## Running locally

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

## Project status

Palamedes is an experimental prototype rather than an actively maintained commercial product.

The repository represents an exploration of AI-assisted professional workflows, document processing and case-management architecture.
