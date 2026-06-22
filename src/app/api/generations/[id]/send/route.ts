import { and, desc, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cases, db, generationMessages, generations } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { sendToClientEnabled } from '@/lib/flags';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { sendMail } from '@/lib/outlook/graph';
import { getConnection, getValidAccessToken } from '@/lib/outlook/tokens';
import { getTool } from '@/lib/tools/registry';

// POST /api/generations/[id]/send — email the current draft of a
// generation via the connected Outlook mailbox (Graph /me/sendMail).
//
// Gated to the client-care-letter tool for now. The feature flag
// SEND_TO_CLIENT_ENABLED is a HARD floor: when it's off (the default)
// the recipient is forced to the lawyer's own connected mailbox, and
// any client recipient supplied by the UI is ignored — a draft can
// never reach a client by accident. When on, the lawyer's chosen
// recipient is used (validated here). On success we record the send
// (sent_at / sent_to / sent_to_client) on the generation.

export const runtime = 'nodejs';

// The only tool whose drafts can be sent today.
const SENDABLE_TOOL_ID = 'client-care-letter';

const BodySchema = z.object({
  // The lawyer's chosen recipient — only honoured when the flag is on.
  recipient: z.string().email().optional(),
  // Editable subject from the send dialog; falls back to a derived one.
  subject: z.string().min(1).max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = await getCurrentUserId();

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // Generation + its case (owner-scoped, joined so we get the case title
  // for the default subject in one round-trip).
  const [gen] = await db
    .select({
      id: generations.id,
      toolId: generations.toolId,
      caseTitle: cases.title,
    })
    .from(generations)
    .innerJoin(cases, eq(generations.caseId, cases.id))
    .where(and(eq(generations.id, params.id), eq(generations.ownerId, ownerId)))
    .limit(1);
  if (!gen) {
    return NextResponse.json({ error: 'generation_not_found' }, { status: 404 });
  }
  if (gen.toolId !== SENDABLE_TOOL_ID) {
    return NextResponse.json({ error: 'tool_not_sendable' }, { status: 400 });
  }

  // The current draft is the latest assistant message.
  const [latest] = await db
    .select({ content: generationMessages.content })
    .from(generationMessages)
    .where(
      and(eq(generationMessages.generationId, params.id), eq(generationMessages.role, 'assistant')),
    )
    .orderBy(desc(generationMessages.createdAt))
    .limit(1);
  if (!latest) {
    return NextResponse.json({ error: 'no_draft_to_send' }, { status: 409 });
  }

  // Outlook must be connected — we need both the account_email (the
  // flag-off recipient) and a valid token to send.
  const connection = await getConnection(ownerId, 'outlook').catch(() => ({
    connected: false as const,
    accountEmail: undefined,
  }));
  if (!connection.connected || !connection.accountEmail) {
    return NextResponse.json({ error: 'outlook_not_connected' }, { status: 409 });
  }

  // Recipient resolution — the heart of the feature flag.
  const toClient = sendToClientEnabled();
  let recipient: string;
  if (toClient) {
    // Flag on: use the lawyer's chosen recipient.
    if (!parsed.data.recipient) {
      return NextResponse.json({ error: 'recipient_required' }, { status: 400 });
    }
    recipient = parsed.data.recipient;
  } else {
    // Flag off (default): hard floor — always the connected mailbox.
    recipient = connection.accountEmail;
  }

  const tool = getTool(gen.toolId);
  const subject = parsed.data.subject?.trim() || `${tool?.label ?? 'Letter'} — ${gen.caseTitle}`;

  // Send. A missing Mail.Send scope (mailbox connected before the scope
  // was added) surfaces as insufficient_scope → reconnect prompt.
  try {
    const accessToken = await getValidAccessToken(ownerId, 'outlook');
    // Send the draft as formatted HTML so headings/bold/lists render in the
    // recipient's inbox rather than raw markdown.
    await sendMail(accessToken, {
      to: recipient,
      subject,
      bodyHtml: renderMarkdownToHtml(latest.content),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'send_failed';
    console.error('[send] sendMail failed:', { recipient, subject, message, err });
    if (message === 'insufficient_scope') {
      return NextResponse.json({ error: 'insufficient_scope' }, { status: 409 });
    }
    if (message === 'outlook_not_connected') {
      return NextResponse.json({ error: 'outlook_not_connected' }, { status: 409 });
    }
    return NextResponse.json({ error: 'send_failed', message }, { status: 502 });
  }

  // Record the send (overwrites any previous send with the latest).
  const sentAt = new Date();
  await db
    .update(generations)
    .set({ sentAt, sentTo: recipient, sentToClient: toClient, updatedAt: sentAt })
    .where(eq(generations.id, params.id));

  return NextResponse.json({
    ok: true,
    sentAt: sentAt.toISOString(),
    sentTo: recipient,
    sentToClient: toClient,
  });
}
