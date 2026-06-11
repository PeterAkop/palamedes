import { DrizzleAdapter } from '@auth/drizzle-adapter';
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';
import { accounts, db, sessions, users, verificationTokens } from '@/db/db';

// Full Auth.js config (Node): the edge-safe shared config + the Drizzle
// adapter (users/accounts in our own Postgres). Used by the route
// handler, server components, and server actions.
//
// "Sign in with Microsoft" — the same Azure app registration as the
// Outlook mailbox connection can host sign-in; add the redirect URI
//   <origin>/api/auth/callback/microsoft-entra-id
// Env: AUTH_SECRET, AUTH_MICROSOFT_ENTRA_ID_ID / _SECRET / _ISSUER.

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
});
