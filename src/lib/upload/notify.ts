import { and, eq } from 'drizzle-orm';
import { cases, clients, db } from '@/db/db';
import { type MailAttachment, sendMail, sendMailWithAttachments } from '@/lib/outlook/graph';
import { getConnection, getValidAccessToken } from '@/lib/outlook/tokens';

// Notify the lawyer when a client uploads files via a tokenised link, and
// MIRROR the uploaded files as attachments so the materials are in the
// mailbox even if the app is down. Big files go through Graph upload
// sessions (see sendMailWithAttachments).
//
// Best-effort: a failure here must never fail the client's upload (the
// files are already ingested as sources). We log and move on.

// Mirror budget. We attach files greedily up to this total; anything beyond
// it is listed by name in the body instead (a mailbox's max message size is
// the real ceiling, and base64 inflates bytes ~33%). 45 MB of raw bytes
// keeps the encoded message comfortably under common Exchange limits while
// still carrying typical multi-file uploads — including a big scan or two.
const ATTACH_BUDGET = 45 * 1024 * 1024;

export interface UploadedFile {
  name: string;
  contentType: string;
  buffer: Buffer;
}

export async function notifyUpload(args: {
  caseId: string;
  ownerId: string;
  files: UploadedFile[];
}): Promise<void> {
  const { caseId, ownerId, files } = args;
  if (files.length === 0) return;

  try {
    // Where to send: the lawyer's connected Outlook mailbox.
    const conn = await getConnection(ownerId, 'outlook');
    if (!conn.connected || !conn.accountEmail) return; // nothing to notify

    // Case + client context for the subject/body.
    const [row] = await db
      .select({
        caseTitle: cases.title,
        firstName: clients.firstName,
        lastName: clients.lastName,
      })
      .from(cases)
      .innerJoin(clients, eq(cases.clientId, clients.id))
      .where(and(eq(cases.id, caseId), eq(cases.ownerId, ownerId)))
      .limit(1);
    if (!row) return;

    const clientName = `${row.firstName} ${row.lastName}`.trim();
    const subject = `Client upload: ${files.length} file${files.length === 1 ? '' : 's'} from ${clientName} — ${row.caseTitle}`;

    // Split files into those we attach (within budget) and those we only
    // list. Iterate in upload order so the lawyer's first files attach.
    const attachments: MailAttachment[] = [];
    const omitted: string[] = [];
    let running = 0;
    for (const f of files) {
      if (running + f.buffer.length <= ATTACH_BUDGET) {
        attachments.push({ name: f.name, contentType: f.contentType, content: f.buffer });
        running += f.buffer.length;
      } else {
        omitted.push(f.name);
      }
    }

    const bodyHtml = buildBody({
      clientName,
      caseTitle: row.caseTitle,
      files,
      omitted,
    });

    const token = await getValidAccessToken(ownerId, 'outlook');
    try {
      await sendMailWithAttachments(token, {
        to: conn.accountEmail,
        subject,
        bodyHtml,
        attachments,
      });
    } catch (sendErr) {
      // The mailbox likely rejected the message for exceeding its max size.
      // Fall back to a notification with no attachments so the lawyer still
      // hears about the upload — the files are safe in the case either way.
      console.error('[notifyUpload] attachment send failed, retrying without:', sendErr);
      await sendMail(token, {
        to: conn.accountEmail,
        subject,
        bodyHtml: buildBody({
          clientName,
          caseTitle: row.caseTitle,
          files,
          omitted: files.map((f) => f.name),
          attachmentsFailed: true,
        }),
      });
    }
  } catch (err) {
    console.error('[notifyUpload] failed:', err);
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function buildBody(args: {
  clientName: string;
  caseTitle: string;
  files: UploadedFile[];
  omitted: string[];
  attachmentsFailed?: boolean;
}): string {
  const { clientName, caseTitle, files, omitted, attachmentsFailed } = args;
  const list = files
    .map(
      (f) =>
        `<li>${esc(f.name)} <span style="color:#888">(${fmtSize(f.buffer.length)})</span></li>`,
    )
    .join('');

  const omittedNote =
    omitted.length > 0 && !attachmentsFailed
      ? `<p style="color:#666">The following file${omitted.length === 1 ? ' was' : 's were'} too large to attach and ${omitted.length === 1 ? 'is' : 'are'} available in the case only:</p><ul>${omitted
          .map((n) => `<li>${esc(n)}</li>`)
          .join('')}</ul>`
      : '';

  const failedNote = attachmentsFailed
    ? `<p style="color:#b45309">The files were too large to attach to this email, but they have been added to the case and are available there.</p>`
    : `<p>The files are attached to this email and have also been added to the case.</p>`;

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">
<p><strong>${esc(clientName)}</strong> has uploaded ${files.length} file${files.length === 1 ? '' : 's'} for the case <strong>${esc(caseTitle)}</strong>.</p>
<ul>${list}</ul>
${failedNote}
${omittedNote}
</div>`;
}
