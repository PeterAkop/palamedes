'use client';

import { CheckCircle2, FileText, FolderUp, UploadCloud, X } from 'lucide-react';
import { type DragEvent, useEffect, useRef, useState } from 'react';
import { ACCEPT_ATTR, collectDroppedFiles, isAcceptedFile } from '@/lib/upload/collect';

// Client-facing upload form for the public /upload/[token] page. Accepts
// individual files, a whole folder, or a drag-and-drop of either (subfolders
// included). Posts the selected files in one request; the server re-validates
// every file (the client-side filter here is a first pass).

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const keyOf = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;

export default function UploadForm({ token }: { token: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute('webkitdirectory', '');
      folderRef.current.setAttribute('directory', '');
    }
  }, []);

  // Add files, keeping only supported types and de-duping against what's
  // already selected (so dropping the same folder twice doesn't pile up).
  function addFiles(incoming: File[]) {
    setError(null);
    const accepted = incoming.filter(isAcceptedFile);
    const skipped = incoming.length - accepted.length;
    setFiles((prev) => {
      const seen = new Set(prev.map(keyOf));
      const merged = [...prev];
      for (const f of accepted) {
        if (!seen.has(keyOf(f))) {
          seen.add(keyOf(f));
          merged.push(f);
        }
      }
      return merged;
    });
    if (skipped > 0) {
      setError(`${skipped} unsupported file${skipped === 1 ? '' : 's'} skipped.`);
    }
  }

  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    addFiles(await collectDroppedFiles(e.dataTransfer));
  }

  async function submit() {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const res = await fetch(`/api/upload/${token}`, { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({}))) as {
        ingested?: number;
        error?: string;
        message?: string;
      };
      if (!res.ok)
        throw new Error(data.message ?? data.error ?? 'Upload failed. Please try again.');
      setDone(data.ingested ?? files.length);
      setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done !== null) {
    return (
      <div className="card bg-base-100 border border-base-300 mt-8">
        <div className="card-body items-center text-center">
          <CheckCircle2 className="h-8 w-8 text-success" />
          <h1 className="card-title text-base">Thank you</h1>
          <p className="text-sm text-base-content/70">
            {done} file{done === 1 ? '' : 's'} uploaded. Your solicitor has been notified.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-100 border border-base-300 mt-8">
      <div className="card-body">
        <h1 className="card-title text-lg gap-2">
          <UploadCloud className="h-5 w-5 text-primary" />
          Upload your documents
        </h1>
        <p className="text-sm text-base-content/70">
          Add the files your solicitor has asked for — drop a folder or pick files. Accepted: PDF,
          images, Word/Excel and text files (max 25 MB each).
        </p>

        {/* Drop zone (files or a folder) + click to choose files. */}
        <label
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`mt-2 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 cursor-pointer transition ${
            dragOver ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-primary/50'
          }`}
        >
          <UploadCloud className="h-6 w-6 text-base-content/40" />
          <span className="text-sm text-base-content/60">
            Drop files or a folder here, or click to choose files
          </span>
          <input
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
          />
        </label>

        <button
          type="button"
          onClick={() => folderRef.current?.click()}
          className="btn btn-ghost btn-sm gap-1 self-start"
        >
          <FolderUp className="h-4 w-4" />
          Choose a folder
        </button>
        <input
          ref={folderRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
        />

        {files.length > 0 && (
          <ul className="mt-1 space-y-1 max-h-64 overflow-y-auto">
            {files.map((f, i) => (
              <li
                key={keyOf(f)}
                className="flex items-center gap-2 text-sm rounded-md border border-base-200 px-2 py-1.5"
              >
                <FileText className="h-4 w-4 text-base-content/50 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-base-content/40 shrink-0">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  disabled={busy}
                  aria-label="Remove file"
                  className="btn btn-ghost btn-xs btn-square"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <div className="alert alert-warning text-sm py-2">
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={busy || files.length === 0}
          className="btn btn-primary mt-2 gap-2"
        >
          {busy ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            <UploadCloud className="h-4 w-4" />
          )}
          {busy
            ? 'Uploading…'
            : `Upload ${files.length || ''} file${files.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}
