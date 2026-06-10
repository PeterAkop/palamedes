import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { cases, db, sources } from '@/db/db';
import { anthropic } from '@/lib/anthropic';
import { getCurrentUserId } from '@/lib/auth';
import { uploadSourceFile } from '@/lib/blob';
import { summarizeFile } from '@/lib/sources/summarize';

// POST /api/sources/upload — accept a file as multipart form data,
// store it in Vercel Blob, upload it to the Anthropic Files API,
// and run Haiku to summarise it. Synchronous: the client sees a
// loading spinner for the round trip (~3–8s for a typical PDF),
// then gets a `ready` row back.
//
// Body shape (multipart):
//   caseId : uuid (string field)
//   file   : the file (Blob)
//   title  : optional string field — falls back to file.name
//
// Returns 201 with the created source row on success, 4xx on bad
// input / missing case / unsupported type / too-large, 502 if the
// blob upload, Files API call, or Haiku fails (the row still
// exists, marked `failed` with `error_message`).
//
// Server-deployment caveat: Next 14 + Vercel defaults the
// serverless body limit to ~4.5 MB. Files larger than that need
// either route config to raise the limit or Vercel Blob's
// client-direct upload pattern (signed URL). Slice 2 ships with
// the simpler server-side flow; if real lawyers hit the 4.5 MB
// wall, swap to the client-direct pattern.

export const runtime = 'nodejs';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const ACCEPTED_MIME: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

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
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'file_too_large', maxBytes: MAX_BYTES, gotBytes: file.size },
      { status: 413 },
    );
  }
  if (!ACCEPTED_MIME.has(file.type)) {
    return NextResponse.json(
      {
        error: 'unsupported_type',
        gotType: file.type,
        accepted: Array.from(ACCEPTED_MIME),
      },
      { status: 415 },
    );
  }

  // Ownership check — confirms the case exists and belongs to the
  // current owner before we burn any Anthropic / Blob spend.
  const caseRow = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.ownerId, ownerId)))
    .limit(1);
  if (caseRow.length === 0) {
    return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
  }

  // Title from user-provided field, fallback to filename.
  const title =
    typeof titleField === 'string' && titleField.trim().length > 0 ? titleField.trim() : file.name;

  // Classify kind: images → `scan` (matches the existing UI's icon
  // for the Source kind), everything else (PDF, future docx) → `file`.
  const kind: 'scan' | 'file' = file.type.startsWith('image/') ? 'scan' : 'file';

  // Insert in `processing` first so the row exists even if a later
  // step throws. We capture mime + size in metadata so the UI cards
  // can show "PDF · 1.2 MB" later.
  const [inserted] = await db
    .insert(sources)
    .values({
      caseId,
      ownerId,
      kind,
      title,
      metadata: { mime_type: file.type, size_bytes: String(file.size) },
      status: 'processing',
    })
    .returning();

  try {
    // 1. Read the file once into a buffer — we need it twice
    //    (Vercel Blob + Anthropic Files API). For 25 MB max this is
    //    cheap; larger files would warrant streaming.
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // 2. Vercel Blob — store the raw bytes for future preview /
    //    download / bundle-export flows. URL goes in `blob_path`.
    const { url: blobUrl } = await uploadSourceFile({
      filename: file.name,
      body: fileBuffer,
      contentType: file.type,
    });

    // 3. Anthropic Files API — upload so we can reference by file_id
    //    in summarisation (and future tool generations). The SDK's
    //    `toFile` helper wraps the buffer with the right metadata.
    const anthropicFile = await anthropic.beta.files.upload({
      file: await toFile(fileBuffer, file.name, { type: file.type }),
      betas: ['files-api-2025-04-14'],
    });

    // 4. Persist both pointers before summarisation — if Haiku then
    //    crashes, we still have the file stored for retry.
    await db
      .update(sources)
      .set({
        blobPath: blobUrl,
        anthropicFileId: anthropicFile.id,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, inserted.id));

    // 5. Summarise via Haiku, referencing the just-uploaded file.
    const { summary, model } = await summarizeFile({
      title,
      mimeType: file.type,
      anthropicFileId: anthropicFile.id,
    });

    // 6. Mark as ready.
    const [updated] = await db
      .update(sources)
      .set({
        status: 'ready',
        aiSummary: summary,
        aiSummaryModel: model,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, inserted.id))
      .returning();

    return NextResponse.json({ source: updated }, { status: 201 });
  } catch (err) {
    // Use the Anthropic SDK's typed errors where applicable, but
    // surface a generic message for anything else (Blob errors,
    // network blips, DB errors).
    let message: string;
    if (err instanceof Anthropic.APIError) {
      message = `Anthropic ${err.status ?? ''}: ${err.message}`.trim();
    } else if (err instanceof Error) {
      message = err.message;
    } else {
      message = 'unknown error';
    }

    await db
      .update(sources)
      .set({
        status: 'failed',
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, inserted.id));

    return NextResponse.json({ error: 'upload_failed', message }, { status: 502 });
  }
}
