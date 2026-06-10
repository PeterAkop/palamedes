import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cases, db, sources } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { summarizePastedMessage } from '@/lib/sources/summarize';

// POST /api/sources/paste — create an email / WhatsApp source on a
// case from pasted text and run Haiku to summarise it. Same
// synchronous, summarise-on-insert pattern as /api/sources/notes:
// the client sees a spinner for the ~1–2s round trip, then gets a
// `ready` row back.
//
// Body shape (validated by Zod):
//   { caseId: uuid, kind: 'email' | 'whatsapp',
//     title: 1–200, body: 1–50_000,
//     from?, subject?, fromPhone?, receivedAt? (ISO datetime) }
//
// Kind-specific metadata is stored in the `metadata` jsonb column:
//   email    → { from, subject }
//   whatsapp → { from_phone }   (from is folded in as a label too)
//
// Returns 201 with the created source row on success, 4xx on bad
// input / missing case, 502 if Haiku fails (the source row still
// exists, marked `failed` with `error_message`).

export const runtime = 'nodejs';

const PasteBodySchema = z.object({
  caseId: z.string().uuid(),
  kind: z.enum(['email', 'whatsapp']),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(50_000),
  from: z.string().max(200).optional(),
  subject: z.string().max(300).optional(),
  fromPhone: z.string().max(50).optional(),
  // When the message was actually sent/received — distinct from
  // created_at (when it landed in Palamedes). Optional; the lawyer
  // may not know it.
  receivedAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  const ownerId = await getCurrentUserId();

  const json = await req.json().catch(() => null);
  const parsed = PasteBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { caseId, kind, title, body, from, subject, fromPhone, receivedAt } = parsed.data;

  // Ownership check before we touch sources — confirms the case
  // exists *and* belongs to the current owner.
  const caseRow = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.ownerId, ownerId)))
    .limit(1);
  if (caseRow.length === 0) {
    return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
  }

  // Build kind-specific metadata; drop undefined keys so the jsonb
  // column only carries what the lawyer actually supplied.
  const metadata: Record<string, string> = {};
  if (from) metadata.from = from;
  if (kind === 'email' && subject) metadata.subject = subject;
  if (kind === 'whatsapp' && fromPhone) metadata.from_phone = fromPhone;

  // Insert in `processing` state — if Haiku crashes mid-call, the row
  // still exists for the user to see (updated to `failed` in catch).
  const [inserted] = await db
    .insert(sources)
    .values({
      caseId,
      ownerId,
      kind,
      title,
      contentPreview: body.slice(0, 300),
      sourceReceivedAt: receivedAt ? new Date(receivedAt) : null,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      status: 'processing',
    })
    .returning();

  try {
    const { summary, model } = await summarizePastedMessage({
      kind,
      title,
      body,
      from,
      subject,
      fromPhone,
    });
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
