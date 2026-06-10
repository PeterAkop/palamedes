import type { NextAuthConfig } from 'next-auth';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';

// Edge-safe Auth.js config (no DB adapter) — shared by the middleware
// (runs on the edge) and the full config in src/auth.ts. The Drizzle
// adapter lives only in src/auth.ts because the Neon driver isn't
// edge-compatible. JWT sessions mean the middleware can authorize from
// the token without a DB read.
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
