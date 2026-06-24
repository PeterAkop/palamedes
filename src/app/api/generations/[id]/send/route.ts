import { and, desc, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cases, db, generationMessages, generations } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { renderMarkdownToHtml } from '@/lib/markdown';
import { sendMail, sendMailWithAttachments } from '@/lib/outlook/graph';
import { getConnection, getValidAccessToken } from '@/lib/outlook/tokens';
import { renderLetterPdf } from '@/lib/pdf/letter';
import { loadFirmLogo } from '@/lib/pdf/logo';
import { getTool } from '@/lib/tools/registry';

// POST /api/generations/[id]/send — email the current draft of a
// generation via the connected Outlook mailbox (Graph /me/sendMail).
//
// Works for any tool. The lawyer picks the recipient in the UI (the
// applicant, their own mailbox, or a typed address); it's validated as
// an email here. On success we record the send (sent_at / sent_to /
// sent_to_client) on the generation — sent_to_client is true when the
// recipient is not the lawyer's own mailbox.

export const runtime = 'nodejs';

const BodySchema = z.object({
  // The lawyer's chosen recipient (required, validated as an email).
  recipient: z.string().email().optional(),
  // Editable subject from the send dialog; falls back to a derived one.
  subject: z.string().min(1).max(500).optional(),
  // Also attach the letter as a PDF (market standard); `logo` includes the
  // firm logo on that PDF. When attaching, the email body is a short cover
  // note by default — `includeBody` repeats the full letter text inline too.
  attachPdf: z.boolean().optional(),
  logo: z.boolean().optional(),
  includeBody: z.boolean().optional(),
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

  // Recipient is the lawyer's chosen address (validated as an email above).
  const recipient = parsed.data.recipient;
  if (!recipient) {
    return NextResponse.json({ error: 'recipient_required' }, { status: 400 });
  }
  // Flag the send as "to client" when it isn't the lawyer's own mailbox.
  const toClient = recipient.toLowerCase() !== connection.accountEmail.toLowerCase();

  const tool = getTool(gen.toolId);
  const subject = parsed.data.subject?.trim() || `${tool?.label ?? 'Letter'} — ${gen.caseTitle}`;

  // Send. A missing Mail.Send scope (mailbox connected before the scope
  // was added) surfaces as insufficient_scope → reconnect prompt.
  try {
    const accessToken = await getValidAccessToken(ownerId, 'outlook');
    const letterHtml = renderMarkdownToHtml(latest.content);

    if (parsed.data.attachPdf) {
      // Letter goes as the PDF attachment; the email body is a short cover
      // note by default so the letter isn't duplicated. `includeBody` repeats
      // the full text inline; `logo` adds the firm letterhead logo to the PDF.
      const logo = parsed.data.logo ? await loadFirmLogo(ownerId) : undefined;
      const pdf = await renderLetterPdf({ content: latest.content, logo });
      const filename = `${tool?.label ?? 'Letter'} - ${gen.caseTitle}`
        .replace(/[^\w.\-() ]/g, '_')
        .slice(0, 120);
      const bodyHtml = parsed.data.includeBody
        ? letterHtml
        : '<p>Please find the letter attached.</p>';
      await sendMailWithAttachments(accessToken, {
        to: recipient,
        subject,
        bodyHtml,
        attachments: [{ name: `${filename}.pdf`, contentType: 'application/pdf', content: pdf }],
      });
    } else {
      // No attachment — send the draft as formatted HTML so headings/bold/
      // lists render in the recipient's inbox rather than raw markdown.
      await sendMail(accessToken, { to: recipient, subject, bodyHtml: letterHtml });
    }
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
