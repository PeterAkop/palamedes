import { randomBytes } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { getAuthorizeUrl } from '@/lib/outlook/oauth';

// GET /api/integrations/outlook/connect — kick off the OAuth flow.
// Generates a CSRF `state`, stashes it (and where to return to) in
// short-lived httpOnly cookies, and redirects to Microsoft's consent
// screen. The user signs in with their own mailbox and approves
// Mail.Read; Microsoft redirects back to /callback.

export const runtime = 'nodejs';

export function GET(req: NextRequest) {
  const state = randomBytes(16).toString('hex');
  const returnTo = req.nextUrl.searchParams.get('returnTo') ?? '/cases';

  const res = NextResponse.redirect(getAuthorizeUrl(state));
  const opts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  };
  res.cookies.set('ms_oauth_state', state, opts);
  res.cookies.set('ms_oauth_return', returnTo, opts);
  return res;
}
