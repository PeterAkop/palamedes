import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cases, db, sources } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { extractAndStoreFacts } from '@/lib/facts/extract';
import { summarizeNote } from '@/lib/sources/summarize';

// POST /api/sources/notes — create a note source on a case and run
// Haiku to summarise it. Synchronous: the client sees a loading
// spinner for the ~1–2s round trip, then gets a `ready` row back.
// When file uploads land (slice 2), we'll shift to a background
// pattern because file summaries can take longer.
//
// Body shape (validated by Zod):
//   { caseId: uuid, title: 1–200 chars, body: 1–20_000 chars }
//
// Returns 201 with the created source row on success, 4xx on bad
// input / missing case, 502 if Haiku fails (the source row still
// exists, marked `failed` with `error_message` — the lawyer sees it
// in the UI and can retry).

// Force Node runtime — Anthropic SDK and Drizzle's Neon HTTP driver
// both work on Edge too, but keeping this on Node sidesteps any
// edge-runtime gotchas with crypto / streams during slice 1.
export const runtime = 'nodejs';

const NoteBodySchema = z.object({
  caseId: z.string().uuid(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
});

export async function POST(req: NextRequest) {
  const ownerId = await getCurrentUserId();

  const json = await req.json().catch(() => null);
  const parsed = NoteBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { caseId, title, body } = parsed.data;

  // Ownership check before we touch sources — confirms the case
  // exists *and* belongs to the current owner. Without this a caller
  // could POST against any caseId and create orphan sources.
  const caseRow = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.ownerId, ownerId)))
    .limit(1);
  if (caseRow.length === 0) {
    return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
  }

  // Insert in `processing` state — if Haiku crashes mid-call, the
  // row still exists for the user to see (we update it to `failed`
  // in the catch below). content_preview gets the leading 300 chars
  // of the body so the collapsed card has something to show.
  const [inserted] = await db
    .insert(sources)
    .values({
      caseId,
      ownerId,
      kind: 'note',
      title,
      contentPreview: body.slice(0, 300),
      rawContent: body,
      status: 'processing',
    })
    .returning();

  try {
    const { summary, model } = await summarizeNote({ title, body });
    const [updated] = await db
      .update(sources)
      .set({
        status: 'ready',
        aiSummary: summary,
        aiSummaryModel: model,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, inserted.id))
      .returning();

    // Pass 1 — extract structured facts (best-effort; never fails the
    // source). Runs after the summary so the row is already `ready`.
    await extractAndStoreFacts(
      { id: inserted.id, caseId, ownerId },
      { mode: 'text', kind: 'note', title, body },
    );

    return NextResponse.json({ source: updated }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    await db
      .update(sources)
      .set({
        status: 'failed',
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, inserted.id));
    return NextResponse.json({ error: 'summary_failed', message }, { status: 502 });
  }
}
