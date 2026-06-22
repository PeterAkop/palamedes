import { NextResponse } from 'next/server';
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

// Auth fence — Auth.js (replaces the old HTTP Basic Auth). Unauthenticated
// requests to any app route are redirected to /sign-in. Public: the
// sign-in page and the Auth.js endpoints (/api/auth/*) — everything else,
// including the Outlook OAuth callback and the API, requires a session.
//
// Uses the edge-safe config (no DB adapter) so it runs in middleware.

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = Boolean(req.auth);
  const isPublic =
    nextUrl.pathname.startsWith('/sign-in') ||
    nextUrl.pathname.startsWith('/api/auth') ||
    // Client document upload via a tokenised link — no account needed.
    nextUrl.pathname.startsWith('/upload/') ||
    nextUrl.pathname.startsWith('/api/upload/');

  if (!isLoggedIn && !isPublic) {
    return NextResponse.redirect(new URL('/sign-in', nextUrl.origin));
  }
  return NextResponse.next();
});

// Gate everything except Next's static assets and the icon.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
