import { createHash } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { db, sources } from '@/db/db';
import { ingestFileSource, validateUploadFile } from '@/lib/sources/ingestFile';
import { resolveUploadLink } from '@/lib/upload/links';
import { notifyUpload, type UploadedFile } from '@/lib/upload/notify';

// POST /api/upload/[token] — PUBLIC (no auth): a client uploads files to a
// case via a tokenised link. The token resolves to the case + owner; files
// are security-validated, then ingested as `client-upload` sources. On
// success we also email the lawyer's mailbox a notification with the
// uploaded files mirrored as attachments (best-effort; see notifyUpload).

export const runtime = 'nodejs';
export const maxDuration = 300; // ingest summarises + extracts per file.

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const link = await resolveUploadLink(params.token);
  if (!link) {
    return NextResponse.json({ error: 'invalid_or_expired_link' }, { status: 404 });
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 });
  }
  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'no_files' }, { status: 400 });
  }

  // Security: validate every file up front; reject the whole batch on any
  // disallowed file so nothing partially lands.
  for (const f of files) {
    const err = validateUploadFile(f);
    if (err) {
      return NextResponse.json(
        { error: err.code, message: err.message, file: f.name },
        { status: 415 },
      );
    }
  }

  let ingested = 0;
  let failed = 0;
  let duplicates = 0;
  // Read each file's bytes once and reuse them for both ingest and the
  // email mirror, so we don't buffer the same upload twice.
  const mirror: UploadedFile[] = [];
  for (const f of files) {
    const buffer = Buffer.from(await f.arrayBuffer());

    // Dedup by content hash, scoped to this case: re-uploading the same file
    // (e.g. a double-submit, or the client clicking the same link again) is
    // a no-op rather than a duplicate source. A prior *failed* attempt is
    // not treated as a duplicate, so the client can retry it.
    const externalId = `client-upload:${createHash('sha256').update(buffer).digest('hex')}`;
    const [existing] = await db
      .select({ id: sources.id })
      .from(sources)
      .where(
        and(
          eq(sources.caseId, link.caseId),
          eq(sources.externalId, externalId),
          ne(sources.status, 'failed'),
        ),
      )
      .limit(1);
    if (existing) {
      duplicates += 1;
      continue;
    }

    const src = await ingestFileSource({
      caseId: link.caseId,
      ownerId: link.ownerId,
      file: f,
      origin: 'client-upload',
      externalId,
      buffer,
    });
    if (src.status === 'failed') failed += 1;
    else ingested += 1;
    // Only mirror newly-added files — no point re-emailing duplicates.
    mirror.push({ name: f.name || 'file', contentType: f.type, buffer });
  }

  // Notify the lawyer + mirror the files to their mailbox. Best-effort:
  // never fails the client's upload (the files are already on the case).
  await notifyUpload({ caseId: link.caseId, ownerId: link.ownerId, files: mirror });

  return NextResponse.json({ ok: true, ingested, failed, duplicates });
}
