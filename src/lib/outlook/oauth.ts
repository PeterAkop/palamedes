// Microsoft identity platform OAuth (delegated) for reading Outlook
// mail. Pull-based POC: authorize → callback exchanges the code →
// tokens stored (encrypted) → refreshed on demand.
//
// Config is read lazily (not at module load) so a missing env var only
// errors at call time — keeps `next build` working before setup.

// Mail.Send lets the app send mail as the connected mailbox (Graph
// /me/sendMail) — used by the Client Care Letter send feature. New
// connections consent to it on first sign-in; connections made before
// this scope was added carry a Mail.Read-only token and must reconnect
// once to grant send.
const SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'email',
  'User.Read',
  'Mail.Read',
  'Mail.Send',
];

interface OutlookConfig {
  clientId: string;
  clientSecret: string;
  tenant: string;
  redirectUri: string;
}

function config(): OutlookConfig {
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const tenant = process.env.MS_TENANT ?? 'common';
  const redirectUri = process.env.MS_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Outlook OAuth not configured — set MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI (and optionally MS_TENANT).',
    );
  }
  return { clientId, clientSecret, tenant, redirectUri };
}

function authority(tenant: string): string {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
}

export function getAuthorizeUrl(state: string): string {
  const c = config();
  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    redirect_uri: c.redirectUri,
    response_mode: 'query',
    scope: SCOPES.join(' '),
    // Force the consent screen every connect. Without this, Microsoft
    // silently re-authorises an account that already consented to an
    // earlier scope set (e.g. Mail.Read) and returns a token WITHOUT the
    // newly-added scope (Mail.Send) — the consent prompt for the new
    // permission never appears. prompt=consent guarantees the user is
    // asked for the current SCOPES, so reconnecting actually upgrades the
    // grant.
    prompt: 'consent',
    state,
  });
  return `${authority(c.tenant)}/authorize?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  scope?: string;
}

async function tokenRequest(extra: Record<string, string>): Promise<TokenResponse> {
  const c = config();
  const res = await fetch(`${authority(c.tenant)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: c.redirectUri,
      ...extra,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Microsoft token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

export function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: 'authorization_code', code, scope: SCOPES.join(' ') });
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  // No `scope` on refresh — deliberately. A refresh can only ever return
  // scopes the user already consented to interactively; asking for a
  // *new* scope here (e.g. Mail.Send on a connection consented under
  // Mail.Read) makes Microsoft reject the whole grant with AADSTS70000
  // ("user must first sign in and grant access"). Omitting scope returns
  // a token carrying the previously-granted scopes — so old Mail.Read
  // connections keep refreshing, and connections that consented to
  // Mail.Send keep it. New scopes are granted only via getAuthorizeUrl
  // (reconnect), which still uses the full SCOPES list.
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}
