import { revalidatePath } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getConnectedEmail } from '@/lib/outlook/graph';
import { exchangeCodeForTokens } from '@/lib/outlook/oauth';
import { saveTokens } from '@/lib/outlook/tokens';

// GET /api/integrations/outlook/callback — Microsoft redirects here with
// `code` + `state`. We verify the state cookie (CSRF), exchange the code
// for tokens, fetch the connected mailbox address, store the tokens
// (encrypted), and redirect back to where the user started with an
// `?outlook=connected|error` flag the UI can surface.

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const returnTo = req.cookies.get('ms_oauth_return')?.value ?? '/cases';

  const back = (status: 'connected' | 'error') => {
    // Invalidate the caches so the page the user lands on re-renders
    // server-side with the new connection state — without this, Next 14.2's
    // Router Cache (experimental.staleTimes) serves the pre-connect page and
    // the header stays on "Connect Outlook". Same fix as revalidateCases().
    // Covers both the case headers (/cases) and the settings page.
    revalidatePath('/cases', 'layout');
    revalidatePath('/settings');
    const url = new URL(returnTo, req.nextUrl.origin);
    url.searchParams.set('outlook', status);
    const res = NextResponse.redirect(url);
    res.cookies.delete('ms_oauth_state');
    res.cookies.delete('ms_oauth_return');
    return res;
  };

  if (params.get('error')) return back('error');

  const code = params.get('code');
  const state = params.get('state');
  const expected = req.cookies.get('ms_oauth_state')?.value;
  if (!code || !state || !expected || state !== expected) return back('error');

  try {
    const tokens = await exchangeCodeForTokens(code);
    const accountEmail = await getConnectedEmail(tokens.access_token).catch(() => undefined);
    await saveTokens({
      ownerId: await getCurrentUserId(),
      provider: 'outlook',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSeconds: tokens.expires_in,
      scope: tokens.scope,
      accountEmail,
    });
    return back('connected');
  } catch {
    return back('error');
  }
}
