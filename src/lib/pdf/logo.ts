import { getSourceFileStream } from '@/lib/blob';
import { getFirmDetails } from '@/lib/firm/queries';

// Load the firm's logo as bytes for the PDF letterhead. Returns undefined
// when no logo is set or it isn't a format react-pdf can embed (PNG/JPEG) —
// the letter then renders cleanly without it.
export async function loadFirmLogo(
  ownerId: string,
): Promise<{ data: Buffer; mime: string } | undefined> {
  const firm = await getFirmDetails(ownerId);
  if (!firm.logoBlobPath) return undefined;

  const blob = await getSourceFileStream(firm.logoBlobPath);
  if (!blob) return undefined;

  const mime = blob.contentType.toLowerCase();
  if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/jpg') {
    return undefined;
  }
  const data = Buffer.from(await new Response(blob.stream).arrayBuffer());
  return { data, mime: mime === 'image/jpg' ? 'image/jpeg' : mime };
}
