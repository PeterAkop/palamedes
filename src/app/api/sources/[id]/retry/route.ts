import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { db, sources } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { reprocessSource } from '@/lib/sources/process';

// POST /api/sources/[id]/retry — re-run analysis (summary + fact
// extraction) for a source. Works for any source, not just `failed` ones.
// The processing → ready/failed lifecycle + dispatch-by-kind live in
// reprocessSource (src/lib/sources/process.ts), shared with the
// whole-case re-analyse route.

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = await getCurrentUserId();

  const rows = await db
    .select()
    .from(sources)
    .where(and(eq(sources.id, params.id), eq(sources.ownerId, ownerId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: 'source_not_found' }, { status: 404 });
  }

  const updated = await reprocessSource(row);
  return NextResponse.json({ source: updated });
}
