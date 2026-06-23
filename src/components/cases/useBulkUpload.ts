'use client';

import { useCallback, useState } from 'react';
import { revalidateCases } from '@/app/cases/actions';
import { isAcceptedFile } from '@/lib/upload/collect';

// Bulk upload to a case: filter to supported files, then POST each to
// /api/sources/upload through a small concurrency pool so dropping a folder
// of many files doesn't fire hundreds of requests at once. Reports progress
// (done / total) and a summary of anything skipped or failed.

const MAX_BYTES = 25 * 1024 * 1024; // mirror the server per-file cap
const CONCURRENCY = 4;

export interface UploadProgress {
  done: number;
  total: number;
}

export function useBulkUpload(caseId: string) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (files: File[]) => {
      setError(null);
      const accepted = files.filter((f) => f.size > 0 && f.size <= MAX_BYTES && isAcceptedFile(f));
      const skipped = files.length - accepted.length;

      if (accepted.length === 0) {
        setError(
          skipped > 0
            ? 'No supported files found (PDF, images, Word/Excel, text; max 25 MB each).'
            : 'No files selected.',
        );
        return;
      }

      setIsUploading(true);
      setProgress({ done: 0, total: accepted.length });

      let done = 0;
      let failed = 0;
      let next = 0;

      async function worker() {
        while (next < accepted.length) {
          const file = accepted[next++];
          try {
            const fd = new FormData();
            fd.append('caseId', caseId);
            fd.append('file', file);
            fd.append('title', file.name);
            const res = await fetch('/api/sources/upload', { method: 'POST', body: fd });
            if (!res.ok) failed += 1;
          } catch {
            failed += 1;
          }
          done += 1;
          setProgress({ done, total: accepted.length });
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, accepted.length) }, () => worker()),
      );

      setIsUploading(false);
      setProgress(null);

      const notes: string[] = [];
      if (failed > 0) notes.push(`${failed} failed`);
      if (skipped > 0) notes.push(`${skipped} unsupported skipped`);
      setError(notes.length > 0 ? notes.join(' · ') : null);

      await revalidateCases();
    },
    [caseId],
  );

  return { upload, isUploading, progress, error };
}
