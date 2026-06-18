'use client';

import { RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { revalidateCases } from '@/app/cases/actions';
import type { SourceStatus } from '@/data/cases';

// Per-source row actions: delete (always) and re-run analysis (any
// non-processing source — re-runs summary + fact extraction). Both hit
// their owner-scoped routes then revalidate so the Sources list
// re-renders.
//
// Lives as a `'use client'` child of the server-rendered SourceRow
// <details> so the buttons can carry onClick handlers. stopPropagation
// keeps a click from toggling the collapsible row open/closed.

interface Props {
  sourceId: string;
  status: SourceStatus;
}

export default function SourceActions({ sourceId, status }: Props) {
  const [isPending, setIsPending] = useState(false);

  async function handleRetry(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsPending(true);
    try {
      await fetch(`/api/sources/${sourceId}/retry`, { method: 'POST' });
    } finally {
      setIsPending(false);
      await revalidateCases();
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Delete this source? This cannot be undone.')) return;
    setIsPending(true);
    try {
      await fetch(`/api/sources/${sourceId}`, { method: 'DELETE' });
    } finally {
      setIsPending(false);
      await revalidateCases();
    }
  }

  return (
    <span className="flex items-center gap-1 shrink-0">
      {status !== 'processing' && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={isPending}
          className="btn btn-ghost btn-xs btn-square"
          aria-label="Re-run analysis"
          title="Re-run analysis (summary + facts)"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
        </button>
      )}
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="btn btn-ghost btn-xs btn-square text-error/70 hover:text-error"
        aria-label="Delete source"
        title="Delete source"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
