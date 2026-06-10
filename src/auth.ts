import { DrizzleAdapter } from '@auth/drizzle-adapter';
import NextAuth from 'next-auth';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import { accounts, db, sessions, users, verificationTokens } from '@/db/db';

// Auth.js (NextAuth v5) — "Sign in with Microsoft". Users / accounts live
// in our own Postgres via the Drizzle adapter (portable, no vendor). JWT
// sessions (stateless — good for Vercel serverless); the session callback
// exposes `user.id` so getCurrentUserId() can read it.
//
// Env (lazy — only needed at request time):
//   AUTH_SECRET                       (openssl rand -base64 33)
//   AUTH_MICROSOFT_ENTRA_ID_ID        Azure app client id
//   AUTH_MICROSOFT_ENTRA_ID_SECRET    Azure app client secret
//   AUTH_MICROSOFT_ENTRA_ID_ISSUER    https://login.microsoftonline.com/<tenant>/v2.0
// The same Azure registration used for the Outlook mailbox connection can
// host sign-in too — just add the redirect URI
//   <origin>/api/auth/callback/microsoft-entra-id

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
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
    // Persist the user id onto the JWT, then surface it on the session.
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id && session.user) session.user.id = token.id as string;
      return session;
    },
  },
});
