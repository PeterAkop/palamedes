import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { cases, db } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { ingestFileSource, validateUploadFile } from '@/lib/sources/ingestFile';

// POST /api/sources/upload — accept a file as multipart form data, store it
// in Blob, summarise it, and extract facts. The actual ingest + security
// validation live in src/lib/sources/ingestFile.ts and are shared with the
// public client-upload route. Owner-scoped; returns the created source row.
//
// Body (multipart): caseId (uuid), file (Blob), title (optional string).

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const ownerId = await getCurrentUserId();

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 });
  }

  const caseId = formData.get('caseId');
  const file = formData.get('file');
  const titleField = formData.get('title');

  if (typeof caseId !== 'string' || caseId.length === 0) {
    return NextResponse.json({ error: 'missing_caseId' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }
  const invalid = validateUploadFile(file);
  if (invalid) {
    return NextResponse.json({ error: invalid.code, message: invalid.message }, { status: 415 });
  }

  // Ownership check — confirms the case exists and belongs to the current
  // owner before we burn any Anthropic / Blob spend.
  const caseRow = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.ownerId, ownerId)))
    .limit(1);
  if (caseRow.length === 0) {
    return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
  }

  const title = typeof titleField === 'string' ? titleField : undefined;
  const source = await ingestFileSource({ caseId, ownerId, file, title });
  if (source.status === 'failed') {
    return NextResponse.json(
      { error: 'upload_failed', message: source.errorMessage },
      { status: 502 },
    );
  }
  return NextResponse.json({ source }, { status: 201 });
}
