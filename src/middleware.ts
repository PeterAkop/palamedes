import { type NextRequest, NextResponse } from 'next/server';

// Fence — keeps casual URL-havers out of the deployed app while we build.
// Not real auth. Replace with session-based auth (Clerk / Supabase /
// Auth.js) when Phase C lands.

const REALM = 'palamedes';

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_USER;
  const pass = process.env.BASIC_PASS;

  // Fail closed if creds aren't configured — never let a missing env var
  // turn into an accidentally-known default password.
  if (!user || !pass) {
    return new NextResponse('Auth not configured', { status: 503 });
  }

  const header = req.headers.get('authorization');
  const expected = `Basic ${btoa(`${user}:${pass}`)}`;

  if (header === expected) {
    return NextResponse.next();
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
    },
  });
}

// Gate everything except Next's static assets and the favicon.
// API routes are intentionally included so file uploads / webhooks are
// also fenced. (Real webhook integrations in Phase A.2 will need a
// per-endpoint exception once we know the public ingestion URLs.)
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
