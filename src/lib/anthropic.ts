import Anthropic from '@anthropic-ai/sdk';

// Shared Anthropic SDK client. Server-only — never import from a
// client component; the API key must stay on the server.
//
// One client object across the app keeps connection state (HTTP
// keep-alive, retry config) shared between every call. Lazy-init via
// the module-load throw keeps build-time evaluation tolerant: a
// missing key fails the first import, which in Next dev shows up as
// a clear stack trace.

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    'ANTHROPIC_API_KEY is not set — add it to .env.local. Get a key from console.anthropic.com with billing enabled (NOT a Claude Pro subscription).',
  );
}

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Model IDs centralised here so when we move (Haiku 4.6, Sonnet 4.7,
// …) we update one place, not every call site. The values match the
// current Claude family — Haiku 4.5 for cheap-and-fast summaries
// across many sources, Sonnet 4.6 for the tool-generation drafts (the
// quality/cost sweet spot; Opus was ~70% of spend for a small lift).
// `opus` is kept for a deliberate high-stakes override if ever needed.
// See https://docs.claude.com → model overview for context + pricing.
export const MODELS = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
} as const;

export type ModelKey = keyof typeof MODELS;
