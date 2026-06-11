import type { NextAuthConfig } from 'next-auth';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';

// Edge-safe Auth.js config (no DB adapter) — shared by the middleware
// (runs on the edge) and the full config in src/auth.ts. The Drizzle
// adapter lives only in src/auth.ts because the Neon driver isn't
// edge-compatible. JWT sessions mean the middleware can authorize from
// the token without a DB read.

// Sign-in allowlist. AUTH_ALLOWED_EMAILS is a comma-separated list of
// exact emails (`manuel@mpbsolicitors.co.uk`) and/or domains
// (`@mpbsolicitors.co.uk` or bare `mpbsolicitors.co.uk`). Matching is
// case-insensitive. If the var is **unset/empty, everyone is allowed**
// (open) — so set it in Vercel to restrict who can sign in.
function isEmailAllowed(email?: string | null): boolean {
  const raw = process.env.AUTH_ALLOWED_EMAILS;
  if (!raw?.trim()) return true; // no allowlist configured → open
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const domain = e.split('@')[1] ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry.startsWith('@')) return domain === entry.slice(1);
      if (!entry.includes('@')) return domain === entry; // bare domain
      return e === entry; // exact email
    });
}

export const authConfig = {
  session: { strategy: 'jwt' },
  trustHost: true,
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  ],
  pages: { signIn: '/sign-in' },
  callbacks: {
    // Gate sign-in by the email allowlist. Returning false sends the
    // user back to /sign-in?error=AccessDenied.
    signIn({ user }) {
      return isEmailAllowed(user.email);
    },
    // Persist the user id onto the JWT, then surface it on the session
    // so getCurrentUserId() can read session.user.id.
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id && session.user) session.user.id = token.id as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
