import { Mail } from 'lucide-react';
import TriageList from '@/components/triage/TriageList';
import { getCurrentUserId } from '@/lib/auth';
import { getConnection } from '@/lib/outlook/tokens';
import { listCaseOptions, listPendingTriage } from '@/lib/triage/queries';

// Mailbox triage inbox — owner-scoped. Recent mailbox messages the lawyer
// assigns to cases (or ignores), with Haiku case suggestions. Resilient
// to the integration_tokens / mailbox_messages tables not existing yet.

export const dynamic = 'force-dynamic';

export default async function TriagePage() {
  const outlook = await getConnection(await getCurrentUserId(), 'outlook').catch(() => ({
    connected: false as const,
    accountEmail: undefined,
  }));
  const [items, caseOptions] = await Promise.all([
    listPendingTriage().catch(() => []),
    listCaseOptions().catch(() => []),
  ]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Mailbox triage</h1>
      <p className="text-sm text-base-content/60 mb-6">
        Recent emails from your connected mailbox. Assign each to a case (Claude suggests one) or
        ignore it.
      </p>

      {outlook.connected ? (
        <TriageList items={items} caseOptions={caseOptions} accountEmail={outlook.accountEmail} />
      ) : (
        <div className="card bg-base-100 border border-base-300">
          <div className="card-body items-center text-center gap-3 py-10">
            <Mail className="h-8 w-8 text-base-content/30" />
            <p className="text-base-content/60">
              Connect an Outlook mailbox to triage incoming email into cases.
            </p>
            <a
              href="/api/integrations/outlook/connect?returnTo=/triage"
              className="btn btn-sm btn-primary gap-1"
            >
              <Mail className="h-4 w-4" />
              Connect Outlook
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
