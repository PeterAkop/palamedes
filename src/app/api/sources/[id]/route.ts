import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { db, sources } from '@/db/db';
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
    .returning({ id: sources.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'source_not_found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: deleted[0].id });
}
