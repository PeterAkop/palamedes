// Microsoft Graph client — just the bits the pull needs. All calls use
// the delegated user token (`/me/...`), so we only ever read the
// connected mailbox.

const GRAPH = 'https://graph.microsoft.com/v1.0';

async function graphGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Graph GET ${path.split('?')[0]} failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

// POST to Graph. Many Graph actions (sendMail) return 202 with an empty
// body, so this resolves on any 2xx without parsing. On a 403 we throw a
// recognisable `insufficient_scope` error so the caller can prompt a
// reconnect (mailboxes connected before Mail.Send was added lack it).
async function graphPost(accessToken: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 403) {
      throw new Error('insufficient_scope');
    }
    throw new Error(`Graph POST ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

// Send a plain-text email as the connected mailbox. `saveToSentItems`
// keeps a copy in the lawyer's Sent folder. Throws `insufficient_scope`
// if the token predates the Mail.Send scope (reconnect needed).
export async function sendMail(
  accessToken: string,
  args: { to: string; subject: string; bodyText: string },
): Promise<void> {
  await graphPost(accessToken, '/me/sendMail', {
    message: {
      subject: args.subject,
      body: { contentType: 'Text', content: args.bodyText },
      toRecipients: [{ emailAddress: { address: args.to } }],
    },
    saveToSentItems: true,
  });
}

// Shape of the Graph message fields we $select.
interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
}

export interface OutlookMessage {
  id: string; // Graph message id — used as sources.external_id for dedup
  conversationId?: string;
  subject: string;
  fromName?: string;
  fromAddress?: string;
  receivedDateTime?: string;
  bodyText: string;
  hasAttachments: boolean; // whether to fetch /attachments on ingest
}

// A file attachment on a message. Only real file attachments
// (`#microsoft.graph.fileAttachment`) carry `contentBytes` (base64);
// itemAttachment / referenceAttachment are filtered out — we can't turn
// those into source files without extra Graph round-trips.
export interface OutlookAttachment {
  id: string; // Graph attachment id — part of the source external_id
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentBytes: string; // base64-encoded file bytes
}

interface GraphAttachment {
  '@odata.type'?: string;
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentBytes?: string;
}

// Lighter shape for the triage sync — no full body (fetched on assign).
export interface RecentMessage {
  id: string;
  conversationId?: string;
  subject: string;
  fromName?: string;
  fromAddress?: string;
  receivedDateTime?: string;
  snippet: string;
}

// The connected mailbox address — stored as account_email for the UI.
export async function getConnectedEmail(accessToken: string): Promise<string | undefined> {
  const me = await graphGet<{ mail?: string; userPrincipalName?: string }>(
    accessToken,
    '/me?$select=mail,userPrincipalName',
  );
  return me.mail ?? me.userPrincipalName ?? undefined;
}

// Messages where `email` appears (from / to / cc / subject / body).
// `$search` matches the quoted address across those fields; `$top`
// bounds the first pull. (`$search` can't combine with `$orderby`, so
// we sort client-side if needed.)
export async function listMessagesForEmail(
  accessToken: string,
  email: string,
  top = 50,
): Promise<OutlookMessage[]> {
  const search = encodeURIComponent(`"${email}"`);
  const select = 'id,subject,from,receivedDateTime,bodyPreview,body,hasAttachments';
  const data = await graphGet<{ value?: GraphMessage[] }>(
    accessToken,
    `/me/messages?$search=${search}&$top=${top}&$select=${select}`,
  );
  return (data.value ?? []).map(toOutlookMessage);
}

// The N most-recent mailbox messages (any sender) for the triage inbox.
// Ordered by date; body excluded to keep it light (full body is fetched
// on assign via getMessageById).
export async function listRecentMessages(accessToken: string, top = 50): Promise<RecentMessage[]> {
  const select = 'id,conversationId,subject,from,receivedDateTime,bodyPreview';
  const data = await graphGet<{ value?: GraphMessage[] }>(
    accessToken,
    `/me/messages?$top=${top}&$orderby=receivedDateTime%20desc&$select=${select}`,
  );
  return (data.value ?? []).map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    subject: m.subject?.trim() || '(no subject)',
    fromName: m.from?.emailAddress?.name,
    fromAddress: m.from?.emailAddress?.address,
    receivedDateTime: m.receivedDateTime,
    snippet: (m.bodyPreview ?? '').trim(),
  }));
}

// One full message by id — used on assign to get the body for the source.
export async function getMessageById(accessToken: string, id: string): Promise<OutlookMessage> {
  const select = 'id,conversationId,subject,from,receivedDateTime,bodyPreview,body,hasAttachments';
  const m = await graphGet<GraphMessage>(
    accessToken,
    `/me/messages/${encodeURIComponent(id)}?$select=${select}`,
  );
  return toOutlookMessage(m);
}

// File attachments on a message. Only `fileAttachment`s with inline
// base64 `contentBytes` are returned (the shape we can store) — inline
// signature images are included here but the caller filters them out.
export async function listMessageAttachments(
  accessToken: string,
  messageId: string,
): Promise<OutlookAttachment[]> {
  const data = await graphGet<{ value?: GraphAttachment[] }>(
    accessToken,
    `/me/messages/${encodeURIComponent(messageId)}/attachments`,
  );
  return (data.value ?? [])
    .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment' && a.contentBytes)
    .map((a) => ({
      id: a.id,
      name: a.name?.trim() || 'attachment',
      contentType: a.contentType || 'application/octet-stream',
      size: a.size ?? 0,
      isInline: a.isInline ?? false,
      contentBytes: a.contentBytes as string,
    }));
}

function toOutlookMessage(m: GraphMessage): OutlookMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    subject: m.subject?.trim() || '(no subject)',
    fromName: m.from?.emailAddress?.name,
    fromAddress: m.from?.emailAddress?.address,
    receivedDateTime: m.receivedDateTime,
    bodyText: htmlToText(
      m.body?.contentType === 'html'
        ? (m.body?.content ?? '')
        : (m.body?.content ?? m.bodyPreview ?? ''),
    ),
    hasAttachments: m.hasAttachments ?? false,
  };
}

// Cheap HTML→text for email bodies — strips tags/entities so the
// summary + content_preview are clean. Not a full parser; good enough
// for feeding Haiku and showing a preview.
function htmlToText(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
