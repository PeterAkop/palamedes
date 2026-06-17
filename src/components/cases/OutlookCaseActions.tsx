'use client';

import { Mail, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { revalidateCases } from '@/app/cases/actions';

// Outlook connect / pull control in the case header.
// - Not connected → "Connect Outlook" link that starts the OAuth flow
//   (returns to this case afterwards).
// - Connected → "Pull from Outlook" button that imports case-related
//   emails (client participant, or client name / matter reference in the
//   subject) as sources.

interface Props {
  caseId: string;
  connected: boolean;
  accountEmail?: string;
}

export default function OutlookCaseActions({ caseId, connected, accountEmail }: Props) {
  const [isPulling, setIsPulling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!connected) {
    return (
      <a
        href={`/api/integrations/outlook/connect?returnTo=/cases/${caseId}`}
        className="btn btn-sm btn-ghost gap-1"
      >
        <Mail className="h-4 w-4" />
        Connect Outlook
      </a>
    );
  }

  async function pull() {
    setMessage(null);
    setIsPulling(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/pull-outlook`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as {
        imported?: number;
        skipped?: number;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(
          data.error === 'no_search_terms'
            ? 'Add a client name, email, or reference first'
            : (data.message ?? data.error ?? 'Pull failed'),
        );
      }
      const skipped = data.skipped ? `, ${data.skipped} already imported` : '';
      setMessage(`Imported ${data.imported ?? 0} email${data.imported === 1 ? '' : 's'}${skipped}`);
      await revalidateCases();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Pull failed');
    } finally {
      setIsPulling(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {message && <span className="text-xs text-base-content/60">{message}</span>}
      <button
        type="button"
        onClick={pull}
        disabled={isPulling}
        title={`Pull case-related emails (connected as ${accountEmail ?? 'Outlook'})`}
        className="btn btn-sm btn-ghost gap-1"
      >
        {isPulling ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        {isPulling ? 'Pulling…' : 'Pull from Outlook'}
      </button>
    </div>
  );
}
