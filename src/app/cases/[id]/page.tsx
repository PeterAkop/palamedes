import { Calendar } from 'lucide-react';
import { notFound } from 'next/navigation';
import CaseTabs from '@/components/cases/CaseTabs';
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL } from '@/data/cases';
import { getCaseById, getClientById } from '@/lib/cases/queries';

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
      </div>

      <CaseTabs caseData={caseData} client={client} />
    </div>
  );
}
