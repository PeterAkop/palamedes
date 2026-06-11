import { handlers } from '@/auth';

// Auth.js catch-all route — handles /api/auth/* (sign-in, callback,
// session, sign-out) for every configured provider.
export const { GET, POST } = handlers;
