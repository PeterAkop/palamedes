'use client';

import { Loader2, Upload } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { revalidateCases } from '@/app/cases/actions';

// "Upload" button + hidden file input. No modal — picking a file is
// the entire UX. Click → native file picker → file selected → POST
// multipart to /api/sources/upload → router.refresh() once the
// route returns a ready source row.
//
// Loading state takes over the button while the upload + Anthropic
// Files API + Haiku summary round-trip; for a 1–5 MB PDF that's
// usually 3–8 seconds. Errors surface inline next to the button.

const ACCEPTED = '.pdf,.jpg,.jpeg,.png,.webp';

// Mirror of the route's server-side limit so we fail fast instead of
// uploading 25 MB and seeing the 413 come back.
const MAX_BYTES = 25 * 1024 * 1024;

interface Props {
  caseId: string;
}

export default function UploadButton({ caseId }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickFile() {
    setError(null);
    fileInputRef.current?.click();
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input *before* the early return so the same file can
    // be reselected (browsers ignore a change event if the new value
    // equals the previous one).
    e.target.value = '';
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setError(`Too large (${(file.size / 1024 / 1024).toFixed(1)} MB); max 25 MB`);
      return;
    }

    setError(null);
    setIsPending(true);

    try {
      const formData = new FormData();
      formData.append('caseId', caseId);
      formData.append('file', file);
      formData.append('title', file.name);

      const res = await fetch('/api/sources/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(data.message ?? data.error ?? 'Upload failed');
      }

      await revalidateCases();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-error max-w-[14rem] truncate">{error}</span>}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        onChange={handleFile}
        disabled={isPending}
        className="hidden"
      />
      <button
        type="button"
        onClick={pickFile}
        disabled={isPending}
        className="btn btn-sm btn-primary gap-1"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {isPending ? 'Summarising…' : 'Upload'}
      </button>
    </div>
  );
}
