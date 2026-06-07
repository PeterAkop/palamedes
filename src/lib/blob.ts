import { put } from '@vercel/blob';

// Thin wrapper around `@vercel/blob`. Route handlers call into this
// rather than importing the SDK directly so future cross-cutting
// concerns (per-request scoping, retry, telemetry) live in one
// place. Today there's only one function; as more features need
// blob storage (generated case bundles, exported PDFs), more
// functions land here.
//
// Server-only — the read/write token must never reach the client.

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error(
    'BLOB_READ_WRITE_TOKEN is not set — add it to .env.local. Provision via Vercel Storage → Blob → Connect to Project.',
  );
}

export interface UploadResult {
  url: string;
  pathname: string;
}

// Source files are uploaded under `sources/` so future blob types
// (case bundles, exported PDFs) stay separable. `addRandomSuffix`
// avoids collisions when two lawyers upload `passport.pdf` to
// different cases. Blobs are `public` — the URL itself is
// unguessable, and the app gates discovery behind the Basic Auth
// fence; per-user signed URLs are a Phase B concern.
export async function uploadSourceFile(args: {
  filename: string;
  body: Buffer | Blob;
  contentType: string;
}): Promise<UploadResult> {
  const result = await put(`sources/${args.filename}`, args.body, {
    access: 'public',
    contentType: args.contentType,
    addRandomSuffix: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return { url: result.url, pathname: result.pathname };
}
