import { Calendar } from 'lucide-react';
import { notFound } from 'next/navigation';
import CaseTabs from '@/components/cases/CaseTabs';
import DeleteCaseButton from '@/components/cases/DeleteCaseButton';
import OutlookCaseActions from '@/components/cases/OutlookCaseActions';
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL } from '@/data/cases';
import { getCurrentUserId } from '@/lib/auth';
import { getCaseById, getClientById } from '@/lib/cases/queries';
import { sendToClientEnabled } from '@/lib/flags';
import { getConnection } from '@/lib/outlook/tokens';

// Force-dynamic at the page level too. The parent layout sets the
// same flag, but route segment config doesn't cascade — without
// this, Next's dev server caches the rendered HTML by URL and new
// sources added via POST /api/sources/notes don't appear until the
// cache TTL expires. We rely on `router.refresh()` from the client
// to re-render after mutations, which only works when the page
// itself is dynamic.
export const dynamic = 'force-dynamic';

interface Props {
  params: { id: string };
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default async function CaseDetailPage({ params }: Props) {
  const caseData = await getCaseById(params.id);
  if (!caseData) notFound();

  const client = await getClientById(caseData.clientId);
  const clientLabel = client ? `${client.firstName} ${client.lastName}` : 'Unknown client';

  // Outlook connection status for this owner. Resilient to the
  // integration_tokens table not existing yet (pre-migration) so the
  // page never crashes — defaults to "not connected".
  const outlook = await getConnection(await getCurrentUserId(), 'outlook').catch(() => ({
    connected: false as const,
    accountEmail: undefined,
  }));

  // Send config for the Tools tab. `toClient` (the global feature flag)
  // decides whether the lawyer can pick a client recipient or sending is
  // locked to their own mailbox. `clientCandidates` are the addresses we
  // surface when the flag is on: the structured client email plus the
  // distinct `from` addresses of grabbed email sources on the case.
  const clientCandidates = Array.from(
    new Set(
      [
        client?.email,
        ...caseData.sources.filter((s) => s.kind === 'email').map((s) => s.metadata?.from),
      ]
        .map((e) => e?.trim())
        .filter((e): e is string => Boolean(e)),
    ),
  );
  const sendConfig = {
    enabled: sendToClientEnabled(),
    outlookConnected: outlook.connected,
    mailbox: outlook.accountEmail,
    clientCandidates,
  };

  return (
    <div className="space-y-6">
      {/* Case header — stays above the tabs so the case identity is
          always visible. Status badge + reference + deadline on one
          line for quick scan. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold truncate">{caseData.title}</h1>
          <p className="text-sm text-base-content/60 mt-1 flex items-center gap-2 flex-wrap">
            <span>{clientLabel}</span>
            <span className="text-base-content/30">·</span>
            <span>{CASE_TYPE_LABEL[caseData.caseType]}</span>
            <span className="text-base-content/30">·</span>
            <span className="badge badge-ghost badge-sm">{CASE_STATUS_LABEL[caseData.status]}</span>
            {caseData.deadline && (
              <>
                <span className="text-base-content/30">·</span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Due {formatDate(caseData.deadline)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <OutlookCaseActions
            caseId={caseData.id}
            connected={outlook.connected}
            accountEmail={outlook.accountEmail}
            clientEmail={client?.email}
          />
          <DeleteCaseButton caseId={caseData.id} caseTitle={caseData.title} />
        </div>
      </div>

      <CaseTabs caseData={caseData} client={client} send={sendConfig} />
    </div>
  );
}
