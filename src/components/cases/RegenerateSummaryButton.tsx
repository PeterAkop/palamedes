'use client';

import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { revalidateCases } from '@/app/cases/actions';

// "Regenerate" button on the case-summary card. POSTs to
// /api/cases/[id]/summary, which rolls up the source summaries with
// Haiku and writes the ai_summary columns, then router.refresh() so
// the Overview re-renders with the new summary.

interface Props {
  caseId: string;
  hasSummary: boolean;
}

export default function RegenerateSummaryButton({ caseId, hasSummary }: Props) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setIsPending(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/summary`, { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(
          data.error === 'no_ready_sources'
            ? 'Add and summarise some sources first.'
            : (data.message ?? data.error ?? 'Failed to generate summary'),
        );
      }
      await revalidateCases();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate summary');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-error">{error}</span>}
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="btn btn-sm btn-ghost gap-1"
      >
        {isPending ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
        {hasSummary ? 'Regenerate' : 'Generate'}
      </button>
    </div>
  );
}
