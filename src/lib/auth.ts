// Placeholder auth — replaced when real auth lands (Phase C).
//
// Every request today comes from "the lawyer" behind the HTTP Basic
// Auth fence (src/middleware.ts). There is no real per-user session
// yet, so every client / case / source / generation gets the same
// owner.
//
// When real auth lands:
//   - Read the session (cookie or provider SDK).
//   - Return the authenticated user's id (Supabase uuid, Clerk
//     `user_…`, etc.) — the column type is `text` so any of those work.
//   - Make this async if the provider's session lookup is async.
//
// API routes and server components call `getCurrentUserId()` and never
// need to know whether it's a real user or the fence stand-in.

const FENCE_USER_ID = 'fence-user';

export function getCurrentUserId(): string {
  return FENCE_USER_ID;
}
