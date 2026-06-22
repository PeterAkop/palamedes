import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt } from 'drizzle-orm';
import { db, uploadLinks } from '@/db/db';

// Tokenised client-upload links. The token is a random URL-safe string in
// the link (/upload/<token>); resolving it yields the case + owner. Links
// expire so a leaked URL can't be used indefinitely.

const LINK_TTL_DAYS = 30;

export interface ResolvedUploadLink {
  caseId: string;
  ownerId: string;
}

export async function createUploadLink(caseId: string, ownerId: string): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(uploadLinks).values({ token, caseId, ownerId, expiresAt });
  return token;
}

// Resolve a token to its case/owner, only if it exists and hasn't expired.
export async function resolveUploadLink(token: string): Promise<ResolvedUploadLink | null> {
  const [row] = await db
    .select({ caseId: uploadLinks.caseId, ownerId: uploadLinks.ownerId })
    .from(uploadLinks)
    .where(and(eq(uploadLinks.token, token), gt(uploadLinks.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

// Reuse the case's current (non-expired) link if there is one, else mint a
// new one — so the same case keeps a stable link across emails.
export async function getOrCreateUploadLink(caseId: string, ownerId: string): Promise<string> {
  const [existing] = await db
    .select({ token: uploadLinks.token })
    .from(uploadLinks)
    .where(
      and(
        eq(uploadLinks.caseId, caseId),
        eq(uploadLinks.ownerId, ownerId),
        gt(uploadLinks.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(uploadLinks.createdAt))
    .limit(1);
  if (existing) return existing.token;
  return createUploadLink(caseId, ownerId);
}
