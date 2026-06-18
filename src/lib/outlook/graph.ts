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

// The connected mailbox address — stored as account_email for the UI.
export async function getConnectedEmail(accessToken: string): Promise<string | undefined> {
  const me = await graphGet<{ mail?: string; userPrincipalName?: string }>(
    accessToken,
    '/me?$select=mail,userPrincipalName',
  );
  return me.mail ?? me.userPrincipalName ?? undefined;
}

// The terms that identify a case's mail. A message is pulled if it
// matches ANY of these (logical OR):
//   - clientEmail  → the client is a participant (from / to / cc / bcc)
//   - clientName   → the client's full name appears in the SUBJECT
//   - references[] → a matter reference appears in the SUBJECT
// Name / reference are subject-scoped on purpose: it's the cheap,
// high-precision signal for case mail the client's address isn't on
// (e.g. the lawyer emailing from another mailbox with "Daniel Okafor"
// in the subject). No body parsing — all matching is server-side.
export interface CaseSearchTerms {
  clientEmail?: string;
  clientName?: string;
  references?: string[];
}

// Pagination bounds for the pull. `$search` returns at most a page of
// relevance-ranked hits and can't be combined with `$orderby`, so we
// page via `@odata.nextLink` up to PULL_MAX and order client-side.
const PULL_PAGE_SIZE = 50;
const PULL_MAX = 200;
const MESSAGE_SELECT =
  'id,conversationId,subject,from,receivedDateTime,bodyPreview,body,hasAttachments';

// Build a KQL subject restriction for a multi-word term by AND-ing each
// word: `Daniel Okafor` → `subject:Daniel AND subject:Okafor`. We can't
// use a quoted phrase (`subject:"Daniel Okafor"`) — Graph rejects a
// double quote nested inside the outer `$search` quotes with a 400 — so
// "all words present in the subject" is the robust stand-in. Words are
// split on any non-alphanumeric char (handles names, slashed refs like
// `MPB/1234` → `subject:MPB AND subject:1234`). Returns null if nothing
// usable is left.
function subjectClause(term: string): string | null {
  const words = term.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
  if (words.length === 0) return null;
  return words.map((w) => `subject:${w}`).join(' AND ');
}

// Run ONE `$search` clause and page via `@odata.nextLink` up to `max`.
// The clause is a single KQL form — `participants:<addr>` or AND-ed
// `subject:<word>` restrictions — wrapped in the double quotes Graph
// requires. The clause must contain NO double quotes of its own: a quote
// nested inside the outer `$search` quotes is a 400 syntax error. We also
// don't OR-combine clauses inside one `$search` (same reason once an
// address is involved), so each clause is its own request and the caller
// merges the results.
async function searchMessages(
  accessToken: string,
  kql: string,
  max: number,
): Promise<GraphMessage[]> {
  const collected: GraphMessage[] = [];
  let path: string | null =
    `/me/messages?$search=${encodeURIComponent(`"${kql}"`)}` +
    `&$top=${PULL_PAGE_SIZE}&$select=${MESSAGE_SELECT}`;
  while (path && collected.length < max) {
    const data: { value?: GraphMessage[]; '@odata.nextLink'?: string } = await graphGet(
      accessToken,
      path,
    );
    collected.push(...(data.value ?? []));
    // nextLink is an absolute URL; strip the Graph base so graphGet can reuse it.
    const next = data['@odata.nextLink'];
    path = next ? next.replace(GRAPH, '') : null;
  }
  return collected.slice(0, max);
}

// Messages matching any of the case's identifying terms, deduped by id,
// with subject/name/reference hits ranked ahead of address-only hits
// (newest-first within each group). Returns [] if no terms were given.
export async function listMessagesForCase(
  accessToken: string,
  terms: CaseSearchTerms,
  max = PULL_MAX,
): Promise<OutlookMessage[]> {
  const subjectTerms = [terms.clientName, ...(terms.references ?? [])]
    .map((t) => t?.trim())
    .filter((t): t is string => Boolean(t));

  // One clause per term. The address is matched as a participant
  // (from/to/cc/bcc), unquoted — quoting an `@` value breaks Graph's
  // parser. Names / references are matched as AND-ed subject words
  // (see subjectClause) — all words must appear in the subject.
  const clauses: Array<{ kql: string; subjectScoped: boolean }> = [];
  const email = terms.clientEmail?.trim();
  if (email) clauses.push({ kql: `participants:${email}`, subjectScoped: false });
  for (const t of subjectTerms) {
    const kql = subjectClause(t);
    if (kql) clauses.push({ kql, subjectScoped: true });
  }
  if (clauses.length === 0) return [];

  const byId = new Map<string, OutlookMessage>();
  const subjectHitIds = new Set<string>();
  for (const clause of clauses) {
    if (byId.size >= max) break;
    const found = await searchMessages(accessToken, clause.kql, max);
    for (const g of found) {
      const m = toOutlookMessage(g);
      if (!byId.has(m.id)) byId.set(m.id, m);
      if (clause.subjectScoped) subjectHitIds.add(m.id);
    }
  }

  // Subject/name/reference hits first — the high-signal matches — then
  // address-only hits; newest-first within each group since `$search`
  // couldn't order for us.
  return [...byId.values()].sort((a, b) => {
    const rankA = subjectHitIds.has(a.id) ? 0 : 1;
    const rankB = subjectHitIds.has(b.id) ? 0 : 1;
    if (rankA !== rankB) return rankA - rankB;
    return (b.receivedDateTime ?? '').localeCompare(a.receivedDateTime ?? '');
  });
}

// One full message by id — used to backfill an email source's full body
// (re-fetch the original from Outlook for sources stored before we
// persisted raw_content). Throws if the message no longer exists.
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
