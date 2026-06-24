import { type NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { getSourceFileStream, uploadSourceFile } from '@/lib/blob';
import { getFirmDetails, setFirmLogo } from '@/lib/firm/queries';

// Firm logo — upload / serve / remove. The logo renders on the PDF
// letterhead (and could later sit on letters). Stored as a private Blob;
// the path lives on firm_settings.logo_blob_path.

export const runtime = 'nodejs';

const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/jpg']);
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB — a logo, not a document

// GET — stream the current logo so the Settings page can preview it
// (the Blob is private, so it can't be loaded by URL directly).
export async function GET() {
  const ownerId = await getCurrentUserId();
  const firm = await getFirmDetails(ownerId);
  if (!firm.logoBlobPath) {
    return NextResponse.json({ error: 'no_logo' }, { status: 404 });
  }
  const blob = await getSourceFileStream(firm.logoBlobPath);
  if (!blob) {
    return NextResponse.json({ error: 'logo_unavailable' }, { status: 404 });
  }
  return new NextResponse(blob.stream, {
    status: 200,
    headers: { 'Content-Type': blob.contentType, 'Cache-Control': 'no-store' },
  });
}

export async function POST(req: NextRequest) {
  const ownerId = await getCurrentUserId();

  const formData = await req.formData().catch(() => null);
  const file = formData?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }
  if (!ACCEPTED.has(file.type)) {
    return NextResponse.json(
      { error: 'unsupported_type', message: 'Logo must be a PNG or JPEG.' },
      { status: 415 },
    );
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'bad_size', message: 'Logo must be under 3 MB.' },
      { status: 413 },
    );
  }

  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  const { url } = await uploadSourceFile({
    filename: `firm-logo.${ext}`,
    body: Buffer.from(await file.arrayBuffer()),
    contentType: file.type === 'image/jpg' ? 'image/jpeg' : file.type,
  });
  await setFirmLogo(ownerId, url);

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const ownerId = await getCurrentUserId();
  await setFirmLogo(ownerId, null);
  return NextResponse.json({ ok: true });
}
