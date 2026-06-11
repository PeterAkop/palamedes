import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { db, mailboxMessages, sources } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { getSourceFileStream } from '@/lib/blob';

// GET /api/sources/[id] — serve the source's backing file inline
// ("Open file"). Owner-scoped: a caller can only open a file on a source
// they own. Streams the private blob through the server so the
// read-write token / raw private URL never reach the client.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = await getCurrentUserId();

  const [row] = await db
    .select({
      blobPath: sources.blobPath,
      title: sources.title,
      metadata: sources.metadata,
    })
    .from(sources)
    .where(and(eq(sources.id, params.id), eq(sources.ownerId, ownerId)))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'source_not_found' }, { status: 404 });
  if (!row.blobPath) return NextResponse.json({ error: 'no_file' }, { status: 404 });

  const file = await getSourceFileStream(row.blobPath);
  if (!file) return NextResponse.json({ error: 'file_unavailable' }, { status: 404 });

  const meta = (row.metadata ?? {}) as Record<string, string | undefined>;
  const filename = meta.filename ?? row.title;
  return new NextResponse(file.stream, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
      // `inline` lets the browser preview PDFs/images in a new tab;
      // other types download. Quote-escape the filename for the header.
      'Content-Disposition': `inline; filename="${filename.replace(/["\\]/g, '_')}"`,
    },
  });
}

// DELETE /api/sources/[id] — remove a source from a case. Owner-scoped:
// the WHERE clause includes owner_id so a caller can't delete another
// owner's row even with a valid id.
//
// If the deleted source is an Outlook `email` (origin tagged with the
// Graph message id as external_id), its triage item is reset back to
// `pending` so the email can be re-assigned — e.g. to re-ingest it and
// pick up attachments. Without this, an assigned-then-deleted email
// stays `assigned` and never re-surfaces in triage.
//
// TODO: this does not yet clean up the backing Vercel Blob object or
// the Anthropic Files API upload for file/scan kinds — those become
// orphaned. Acceptable for the POC (the Blob URL is unguessable and
// gated by the fence); wire up best-effort cleanup when file volume
// matters.

export const runtime = 'nodejs';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = await getCurrentUserId();

  const deleted = await db
    .delete(sources)
    .where(and(eq(sources.id, params.id), eq(sources.ownerId, ownerId)))
    .returning({
      id: sources.id,
      kind: sources.kind,
      caseId: sources.caseId,
      externalId: sources.externalId,
    });

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'source_not_found' }, { status: 404 });
  }

  const row = deleted[0];

  // Re-open the triage item for a deleted Outlook email so it can be
  // assigned again. Only `email` sources map 1:1 to a mailbox message;
  // attachment sources use a composite external_id and must not match.
  let untriaged = 0;
  if (row.kind === 'email' && row.externalId) {
    const reopened = await db
      .update(mailboxMessages)
      .set({ status: 'pending', assignedCaseId: null, updatedAt: new Date() })
      .where(
        and(
          eq(mailboxMessages.ownerId, ownerId),
          eq(mailboxMessages.externalId, row.externalId),
          eq(mailboxMessages.assignedCaseId, row.caseId),
        ),
      )
      .returning({ id: mailboxMessages.id });
    untriaged = reopened.length;
  }

  return NextResponse.json({ deleted: row.id, untriaged });
}
