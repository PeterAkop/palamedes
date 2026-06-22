import { type NextRequest, NextResponse } from 'next/server';
import { ingestFileSource, validateUploadFile } from '@/lib/sources/ingestFile';
import { resolveUploadLink } from '@/lib/upload/links';

// POST /api/upload/[token] — PUBLIC (no auth): a client uploads files to a
// case via a tokenised link. The token resolves to the case + owner; files
// are security-validated, then ingested as `client-upload` sources.
//
// (P3) On success we also email the lawyer a copy of the uploaded files.

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
  for (const f of files) {
    const src = await ingestFileSource({
      caseId: link.caseId,
      ownerId: link.ownerId,
      file: f,
      origin: 'client-upload',
    });
    if (src.status === 'failed') failed += 1;
    else ingested += 1;
  }

  // TODO (P3): email the lawyer a copy of the uploaded files.

  return NextResponse.json({ ok: true, ingested, failed });
}
