import { createHash } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db, sources } from '@/db/db';

// Content-hash dedup, shared by every file-ingest path (client upload,
// manual upload, Outlook attachments). The same bytes should never become
// two sources on one case — e.g. a file the client uploads is mirrored to
// the lawyer's mailbox by the notification email, so a later "Pull from
// Outlook" would otherwise re-ingest it as an attachment. We stamp each
// source's metadata with `content_sha256` and skip an ingest when the case
// already has a non-failed source carrying the same hash.

export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

// The id of an existing non-failed source on the case with this content
// hash, or null. (A prior *failed* ingest doesn't count, so a real retry
// can still go through.)
export async function findCaseSourceByContentHash(
  caseId: string,
  hash: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.caseId, caseId),
        ne(sources.status, 'failed'),
        sql`${sources.metadata} ->> 'content_sha256' = ${hash}`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}
