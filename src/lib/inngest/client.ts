import { Inngest } from 'inngest';

// Inngest client — the durable job queue behind source analysis. Events
// (`source/created`) are emitted when a source is stored; the worker
// (see functions.ts) runs the AI analysis off the request path so a big
// Outlook pull / bulk upload returns immediately and fills in behind.
//
// Keys come from env (INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY) in prod via
// the Vercel integration; locally the Inngest dev server needs neither.
export const inngest = new Inngest({ id: 'palamedes' });

// Event names, kept in one place so producer + consumer can't drift.
export const EVENTS = {
  sourceCreated: 'source/created',
} as const;

export interface SourceCreatedEvent {
  name: typeof EVENTS.sourceCreated;
  data: { sourceId: string; ownerId: string };
}
