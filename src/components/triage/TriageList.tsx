'use client';

import { Inbox, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { revalidateTriage } from '@/app/triage/actions';
import type { CaseOption, TriageItem } from '@/data/cases';
import TriageRow from './TriageRow';

// Triage inbox list: a "Sync mailbox" button + the pending items.

interface Props {
  items: TriageItem[];
  caseOptions: CaseOption[];
  accountEmail?: string;
}

export default function TriageList({ items, caseOptions, accountEmail }: Props) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setMessage(null);
    setIsSyncing(true);
    try {
      const res = await fetch('/api/integrations/outlook/triage/sync', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as {
        added?: number;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Sync failed');
      setMessage(`Synced — ${data.added ?? 0} new`);
      await revalidateTriage();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-base-content/60 truncate">
          {accountEmail ? `Connected: ${accountEmail}` : 'Connected'}
          {message ? ` · ${message}` : ''}
        </span>
        <button
          type="button"
          onClick={sync}
          disabled={isSyncing}
          className="btn btn-sm btn-primary gap-1 shrink-0"
        >
          {isSyncing ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isSyncing ? 'Syncing…' : 'Sync mailbox'}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="card bg-base-100 border border-base-300">
          <div className="card-body items-center text-center gap-2 py-10 text-base-content/50">
            <Inbox className="h-8 w-8 text-base-content/30" />
            <p>Nothing to triage. Click “Sync mailbox” to pull recent emails.</p>
          </div>
        </div>
      ) : (
        items.map((item) => <TriageRow key={item.id} item={item} caseOptions={caseOptions} />)
      )}
    </div>
  );
}
