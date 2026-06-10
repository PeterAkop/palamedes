'use client';

import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { revalidateTriage } from '@/app/triage/actions';
import type { CaseOption, TriageItem } from '@/data/cases';

// One pending triage item: shows the email + Claude's suggested case, with
// a case picker (defaulting to the suggestion), Assign / Ignore, and an
// optional "whole thread" toggle.

interface Props {
  item: TriageItem;
  caseOptions: CaseOption[];
}

export default function TriageRow({ item, caseOptions }: Props) {
  const suggested = item.suggestedCaseId
    ? caseOptions.find((c) => c.id === item.suggestedCaseId)
    : undefined;

  const [caseId, setCaseId] = useState(item.suggestedCaseId ?? '');
  const [includeThread, setIncludeThread] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    if (!caseId) return;
    setError(null);
    setIsPending(true);
    try {
      const res = await fetch(`/api/integrations/outlook/triage/${item.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, includeThread }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Assign failed');
      }
      await revalidateTriage();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assign failed');
      setIsPending(false);
    }
  }

  async function ignore() {
    setError(null);
    setIsPending(true);
    try {
      await fetch(`/api/integrations/outlook/triage/${item.id}/ignore`, { method: 'POST' });
      await revalidateTriage();
    } catch {
      setIsPending(false);
    }
  }

  const fromLabel = item.fromName
    ? `${item.fromName}${item.fromAddress ? ` <${item.fromAddress}>` : ''}`
    : (item.fromAddress ?? 'Unknown sender');
  const dateLabel = item.receivedAt
    ? new Date(item.receivedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : '';

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body p-4 gap-2">
        <div>
          <p className="font-medium truncate">{item.subject}</p>
          <p className="text-xs text-base-content/60 truncate">
            {fromLabel}
            {dateLabel && ` · ${dateLabel}`}
          </p>
        </div>
        {item.snippet && (
          <p className="text-sm text-base-content/70 line-clamp-2">{item.snippet}</p>
        )}

        {suggested ? (
          <p className="text-xs flex items-start gap-1 text-primary">
            <Sparkles className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              Suggested: <span className="font-medium">{suggested.label}</span>
              {item.suggestionReason ? ` — ${item.suggestionReason}` : ''}
            </span>
          </p>
        ) : (
          <p className="text-xs text-base-content/40">No confident case match — pick one below.</p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            disabled={isPending || caseOptions.length === 0}
            className="select select-bordered select-sm flex-1 min-w-48"
          >
            <option value="" disabled>
              {caseOptions.length === 0 ? 'No cases yet' : 'Choose a case…'}
            </option>
            {caseOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>

          {item.conversationId && (
            <label className="label cursor-pointer gap-1 py-0 text-xs">
              <input
                type="checkbox"
                checked={includeThread}
                onChange={(e) => setIncludeThread(e.target.checked)}
                disabled={isPending}
                className="checkbox checkbox-xs"
              />
              whole thread
            </label>
          )}

          <button
            type="button"
            onClick={assign}
            disabled={isPending || !caseId}
            className="btn btn-sm btn-primary"
          >
            {isPending && <span className="loading loading-spinner loading-xs" />}
            Assign
          </button>
          <button
            type="button"
            onClick={ignore}
            disabled={isPending}
            className="btn btn-sm btn-ghost"
          >
            Ignore
          </button>
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
      </div>
    </div>
  );
}
