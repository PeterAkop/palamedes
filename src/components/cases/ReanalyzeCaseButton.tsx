'use client';

import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { revalidateCases } from '@/app/cases/actions';

// "Re-analyse" button — re-runs analysis (summary + fact extraction) for
// every source on the case, then regenerates the case summary. POSTs to
// /api/cases/[id]/reanalyze (synchronous; can take a while on a case with
// many sources), then revalidates so the Sources / Facts / Overview tabs
// re-render with the refreshed data.

interface Props {
  caseId: string;
  sourceCount: number;
}

export default function ReanalyzeCaseButton({ caseId, sourceCount }: Props) {
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    if (
      !window.confirm(
        `Re-run analysis for all ${sourceCount} source${sourceCount === 1 ? '' : 's'} on this case? This re-summarises and re-extracts facts for each, then regenerates the case summary.`,
      )
    ) {
      return;
    }
    setMessage(null);
    setIsPending(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/reanalyze`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as {
        ready?: number;
        failed?: number;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? 'Re-analysis failed');
      }
      const failedNote = data.failed ? `, ${data.failed} failed` : '';
      setMessage(
        `Re-analysed ${data.ready ?? 0} source${data.ready === 1 ? '' : 's'}${failedNote}`,
      );
      await revalidateCases();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Re-analysis failed');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {message && <span className="text-xs text-base-content/60">{message}</span>}
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending || sourceCount === 0}
        title="Re-run summary + fact extraction for every source, then regenerate the case summary"
        className="btn btn-ghost btn-sm gap-1"
      >
        <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
        {isPending ? 'Re-analysing…' : 'Re-analyse'}
      </button>
    </div>
  );
}
