import type { DefaultSession } from 'next-auth';

// Add `id` to the session user (Auth.js doesn't include it by default).
// Populated in the session callback in src/auth.ts so
// getCurrentUserId() can read `session.user.id`.
declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
  }
}
