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

// Shape of the Graph message fields we $select.
interface GraphMessage {
  id: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
}

export interface OutlookMessage {
  id: string; // Graph message id — used as sources.external_id for dedup
  subject: string;
  fromName?: string;
  fromAddress?: string;
  receivedDateTime?: string;
  bodyText: string;
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
  const select = 'id,subject,from,receivedDateTime,bodyPreview,body';
  const data = await graphGet<{ value?: GraphMessage[] }>(
    accessToken,
    `/me/messages?$search=${search}&$top=${top}&$select=${select}`,
  );
  return (data.value ?? []).map((m) => ({
    id: m.id,
    subject: m.subject?.trim() || '(no subject)',
    fromName: m.from?.emailAddress?.name,
    fromAddress: m.from?.emailAddress?.address,
    receivedDateTime: m.receivedDateTime,
    bodyText: htmlToText(
      m.body?.contentType === 'html'
        ? (m.body?.content ?? '')
        : (m.body?.content ?? m.bodyPreview ?? ''),
    ),
  }));
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
