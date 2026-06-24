'use client';

import { ImageUp, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, useRef, useState } from 'react';

// Firm logo upload for Settings. Uploads a PNG/JPEG to /api/firm/logo, shows
// a preview (served back through the same route since the Blob is private),
// and supports removal. The logo renders on the PDF letterhead.

export default function LogoUpload({ hasLogo }: { hasLogo: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cache-buster so the <img> refreshes after a new upload.
  const [v, setV] = useState(0);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/firm/logo', { method: 'POST', body: fd });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(data.message ?? data.error ?? 'Upload failed');
      }
      setV((n) => n + 1);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/firm/logo', { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-base-content/50 mb-1">Firm logo</h3>
      <p className="text-xs text-base-content/50 mb-2">
        PNG or JPEG, under 3 MB. Appears on the PDF letterhead.
      </p>

      <div className="flex items-center gap-3">
        {hasLogo && (
          // biome-ignore lint/performance/noImgElement: private blob served via our route, not a static asset
          <img
            src={`/api/firm/logo?v=${v}`}
            alt="Firm logo"
            className="h-14 w-auto max-w-[160px] rounded border border-base-300 bg-base-100 object-contain p-1"
          />
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          onChange={onPick}
          disabled={busy}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="btn btn-sm btn-outline gap-1"
        >
          {busy ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <ImageUp className="h-4 w-4" />
          )}
          {hasLogo ? 'Replace logo' : 'Upload logo'}
        </button>
        {hasLogo && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="btn btn-sm btn-ghost text-error gap-1"
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </button>
        )}
      </div>

      {error && <p className="text-xs text-error mt-1">{error}</p>}
    </div>
  );
}
