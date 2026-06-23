import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { functions } from '@/lib/inngest/functions';

// Inngest serve endpoint — Inngest calls this URL to discover and run the
// registered functions. Public by design (verified via signing key in prod);
// must be exempt from auth middleware.
export const runtime = 'nodejs';

export const { GET, POST, PUT } = serve({ client: inngest, functions });
