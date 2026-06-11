import { auth } from '@/auth';

// Per-user identity. Reads the Auth.js session and returns the signed-in
// user's id (`users.id`, a text id from the Microsoft Entra sign-in).
// Every owner-scoped query / route calls this; the rest of the app never
// needs to know how the id is obtained.
//
// Async because the session lookup is async. Throws if there's no
// session — but the middleware (src/middleware.ts) protects every app
// route, so authenticated code always has one. Callers that may run
// unauthenticated (e.g. the header on /sign-in) wrap this in a `.catch`.
export async function getCurrentUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('not_authenticated');
  }
  return session.user.id;
}
