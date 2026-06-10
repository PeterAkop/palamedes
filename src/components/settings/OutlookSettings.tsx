'use client';

import { Mail } from 'lucide-react';
import { useState } from 'react';
import { revalidateSettings } from '@/app/settings/actions';

// Outlook connection panel for the settings page. Shows the connected
// mailbox (or a Connect prompt) and a Disconnect button. Owner-scoped on
// the server — multi-user-safe once real auth lands (each user sees and
// manages only their own mailbox connection).

interface Props {
  connected: boolean;
  accountEmail?: string;
}

export default function OutlookSettings({ connected, accountEmail }: Props) {
  const [isPending, setIsPending] = useState(false);

  async function disconnect() {
    if (!window.confirm('Disconnect Outlook? Pulled sources stay; you can reconnect anytime.')) {
      return;
    }
    setIsPending(true);
    try {
      await fetch('/api/integrations/outlook/disconnect', { method: 'POST' });
      await revalidateSettings();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body">
        <h2 className="card-title text-base gap-2">
          <Mail className="h-4 w-4 text-primary" />
          Outlook
        </h2>
        <p className="text-sm text-base-content/60">
          Connect a mailbox to pull client emails into cases. Delegated, read-only (
          <code>Mail.Read</code>) — Palamedes never sends or changes anything in your inbox.
        </p>

        {connected ? (
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="badge badge-success badge-sm">Connected</span>
              <span className="font-medium">{accountEmail ?? 'Outlook mailbox'}</span>
            </div>
            <button
              type="button"
              onClick={disconnect}
              disabled={isPending}
              className="btn btn-sm btn-ghost text-error/80 hover:text-error"
            >
              {isPending && <span className="loading loading-spinner loading-xs" />}
              Disconnect
            </button>
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-sm text-base-content/50 italic">No mailbox connected.</span>
            <a
              href="/api/integrations/outlook/connect?returnTo=/settings"
              className="btn btn-sm btn-primary gap-1"
            >
              <Mail className="h-4 w-4" />
              Connect Outlook
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
