'use client';

import {
  Calendar,
  CheckCircle2,
  Files,
  FileText,
  Hash,
  Mail,
  MessageCircle,
  NotebookPen,
  Plus,
  Scan,
  Sparkles,
  Upload,
  Wrench,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CASE_STATUS_LABEL,
  CASE_TYPE_LABEL,
  type Case,
  type Client,
  SOURCE_KIND_LABEL,
  type Source,
  type SourceKind,
} from '@/data/cases';

type TabId = 'overview' | 'sources' | 'tools';
const TAB_IDS: readonly TabId[] = ['overview', 'sources', 'tools'] as const;
const DEFAULT_TAB: TabId = 'overview';

interface Props {
  caseData: Case;
  client: Client | undefined;
}

export default function CaseTabs({ caseData, client }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab: TabId =
    rawTab && (TAB_IDS as readonly string[]).includes(rawTab) ? (rawTab as TabId) : DEFAULT_TAB;

  function setTab(tab: TabId) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === DEFAULT_TAB) params.delete('tab');
    else params.set('tab', tab);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }

  return (
    <div className="space-y-4">
      <Tablist active={activeTab} onChange={setTab} sourceCount={caseData.sources.length} />
      {activeTab === 'overview' && <OverviewTab caseData={caseData} client={client} />}
      {activeTab === 'sources' && <SourcesTab sources={caseData.sources} />}
      {activeTab === 'tools' && <ToolsTab caseData={caseData} />}
    </div>
  );
}

// --- Tablist --------------------------------------------------------------

interface TablistProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  sourceCount: number;
}

function Tablist({ active, onChange, sourceCount }: TablistProps) {
  const tabs: Array<{ id: TabId; label: string; badge?: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'sources', label: 'Sources', badge: String(sourceCount) },
    { id: 'tools', label: 'Tools' },
  ];
  return (
    <div role="tablist" className="tabs tabs-bordered">
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={`tab gap-2 ${isActive ? 'tab-active font-semibold' : ''}`}
          >
            {t.label}
            {t.badge && <span className="badge badge-ghost badge-sm">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

// --- Overview tab ---------------------------------------------------------

function OverviewTab({ caseData, client }: { caseData: Case; client: Client | undefined }) {
  return (
    <div className="space-y-4">
      {/* Client card */}
      <div className="card bg-base-100 border border-base-300">
        <div className="card-body">
          <h2 className="card-title text-base">Client</h2>
          {client ? (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-base-content/60">Name</dt>
              <dd className="font-medium">
                {client.firstName} {client.lastName}
              </dd>
              {client.email && (
                <>
                  <dt className="text-base-content/60">Email</dt>
                  <dd>{client.email}</dd>
                </>
              )}
              {client.phone && (
                <>
                  <dt className="text-base-content/60">Phone</dt>
                  <dd>{client.phone}</dd>
                </>
              )}
              {client.nationality && (
                <>
                  <dt className="text-base-content/60">Nationality</dt>
                  <dd>{client.nationality}</dd>
                </>
              )}
              {client.dateOfBirth && (
                <>
                  <dt className="text-base-content/60">DOB</dt>
                  <dd>{client.dateOfBirth}</dd>
                </>
              )}
              {client.preferredLanguage && (
                <>
                  <dt className="text-base-content/60">Language</dt>
                  <dd>{client.preferredLanguage}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="text-base-content/50 italic">Client record not found.</p>
          )}
        </div>
      </div>

      {/* Case details card */}
      <div className="card bg-base-100 border border-base-300">
        <div className="card-body">
          <h2 className="card-title text-base">Case details</h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-base-content/60">Type</dt>
            <dd className="font-medium">{CASE_TYPE_LABEL[caseData.caseType]}</dd>
            <dt className="text-base-content/60">Status</dt>
            <dd>
              <span className="badge badge-ghost badge-sm">
                {CASE_STATUS_LABEL[caseData.status]}
              </span>
            </dd>
            {caseData.homeOfficeReference && (
              <>
                <dt className="text-base-content/60">Reference</dt>
                <dd className="flex items-center gap-1">
                  <Hash className="h-3 w-3 text-base-content/40" />
                  <span>{caseData.homeOfficeReference}</span>
                </dd>
              </>
            )}
            {caseData.deadline && (
              <>
                <dt className="text-base-content/60">Deadline</dt>
                <dd className="flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-base-content/40" />
                  <span>{caseData.deadline}</span>
                </dd>
              </>
            )}
          </dl>
        </div>
      </div>

      {/* Summary card (AI-generated placeholder) */}
      <div className="card bg-base-100 border border-base-300">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="card-title text-base gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Case summary
            </h2>
            <button type="button" className="btn btn-sm btn-ghost gap-1" disabled>
              <Sparkles className="h-3 w-3" />
              Regenerate
            </button>
          </div>
          {caseData.summary ? (
            <p className="text-base-content/80 leading-relaxed text-sm">{caseData.summary}</p>
          ) : (
            <p className="text-base-content/50 italic text-sm">
              Case summary will appear here once sources have been added and analysed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Sources tab ----------------------------------------------------------

function SourcesTab({ sources }: { sources: Source[] }) {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <h2 className="card-title text-base">
            Sources
            <span className="badge badge-ghost badge-sm">{sources.length}</span>
          </h2>
          <div className="flex items-center gap-1">
            <button type="button" className="btn btn-sm btn-ghost gap-1" disabled>
              <NotebookPen className="h-4 w-4" />
              Add note
            </button>
            <button type="button" className="btn btn-sm btn-primary gap-1" disabled>
              <Upload className="h-4 w-4" />
              Upload
            </button>
          </div>
        </div>

        {sources.length === 0 ? (
          <div className="text-center py-10 text-base-content/50">
            <Files className="h-8 w-8 mx-auto mb-2 text-base-content/30" />
            <p>No sources yet — upload files, add notes, or paste WhatsApp / email content.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map((src) => (
              <SourceRow key={src.id} source={src} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceRow({ source }: { source: Source }) {
  const Icon = SOURCE_KIND_ICON[source.kind];
  return (
    <details className="collapse collapse-arrow bg-base-100 border border-base-300">
      <summary className="collapse-title flex items-center gap-3 pr-10 py-2.5 min-h-0 cursor-pointer">
        <Icon className="h-4 w-4 shrink-0 text-base-content/50" />
        <span className="font-medium truncate min-w-0 flex-1">{source.title}</span>
        <SourceStatusBadge status={source.status} />
        <span className="text-xs text-base-content/60 shrink-0 ml-auto pr-2 whitespace-nowrap">
          {SOURCE_KIND_LABEL[source.kind]}
          {source.sourceReceivedAt && ` · ${formatShortDate(source.sourceReceivedAt)}`}
        </span>
      </summary>
      <div className="collapse-content !pb-3 space-y-2 text-sm">
        {source.contentPreview && (
          <p className="text-base-content/70 italic line-clamp-3">{source.contentPreview}</p>
        )}
        {source.aiSummary ? (
          <div className="rounded-md border border-base-200 bg-base-200/40 p-3">
            <p className="text-xs uppercase tracking-wide text-base-content/50 mb-1 flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-primary" /> AI summary
            </p>
            <p className="text-base-content/80 leading-relaxed">{source.aiSummary}</p>
          </div>
        ) : (
          <p className="text-base-content/50 italic">
            AI summary will appear here once the source is processed.
          </p>
        )}
      </div>
    </details>
  );
}

const SOURCE_KIND_ICON: Record<SourceKind, typeof FileText> = {
  whatsapp: MessageCircle,
  email: Mail,
  file: FileText,
  note: NotebookPen,
  scan: Scan,
};

function SourceStatusBadge({ status }: { status: Source['status'] }) {
  if (status === 'ready') return <span className="badge badge-success badge-sm">Ready</span>;
  if (status === 'failed') return <span className="badge badge-error badge-sm">Failed</span>;
  return (
    <span className="badge badge-info badge-sm gap-1">
      <span className="loading loading-spinner loading-xs" />
      Processing…
    </span>
  );
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// --- Tools tab ------------------------------------------------------------

// Hardcoded tool registry for the UI pass. When the real registry lands
// in lib/tools/, this gets replaced with an import + map.
const TOOL_STUB = [
  {
    id: 'client-care-letter',
    label: 'Client Care Letter',
    description: 'SRA-compliant client care letter for new instructions.',
    category: 'Onboarding',
  },
  {
    id: 'cover-letter-spouse-visa',
    label: 'Cover Letter — Spouse Visa',
    description: 'Cover letter for a spouse visa application bundle.',
    category: 'Cover letters',
  },
  {
    id: 'cover-letter-ilr',
    label: 'Cover Letter — ILR',
    description: 'Cover letter for an Indefinite Leave to Remain application.',
    category: 'Cover letters',
  },
  {
    id: 'appeal-grounds',
    label: 'Grounds of Appeal',
    description: 'First-tier Tribunal appeal grounds document.',
    category: 'Appeals',
  },
] as const;

function ToolsTab({ caseData }: { caseData: Case }) {
  // Group tools by category for a tidier list as the registry grows.
  const grouped = TOOL_STUB.reduce<Record<string, (typeof TOOL_STUB)[number][]>>((acc, t) => {
    const bucket = acc[t.category] ?? [];
    bucket.push(t);
    acc[t.category] = bucket;
    return acc;
  }, {});

  // Map of toolId → latest generation for that tool on this case.
  const latestByTool = new Map<string, (typeof caseData.generations)[number]>();
  for (const g of caseData.generations) {
    const prev = latestByTool.get(g.toolId);
    if (!prev || g.version > prev.version) latestByTool.set(g.toolId, g);
  }

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <h2 className="card-title text-base gap-2">
            <Wrench className="h-4 w-4 text-primary" />
            Tools
          </h2>
        </div>

        {Object.entries(grouped).map(([category, tools]) => (
          <div key={category} className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-base-content/50 pt-2">{category}</p>
            <div className="space-y-2">
              {tools.map((t) => {
                const latest = latestByTool.get(t.id);
                return (
                  <div
                    key={t.id}
                    className="border border-base-300 rounded-md p-3 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{t.label}</p>
                      <p className="text-xs text-base-content/60 mt-0.5">{t.description}</p>
                      {latest && (
                        <p className="text-xs text-base-content/50 mt-1 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-success" />
                          Last run — v{latest.version} ({latest.status})
                        </p>
                      )}
                    </div>
                    <button type="button" className="btn btn-sm btn-primary gap-1" disabled>
                      <Plus className="h-3 w-3" />
                      {latest ? 'New run' : 'Generate'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <p className="text-xs text-base-content/50 mt-4">
          Tools wired to Opus + chat-on-generation come in the next branch. This view shows the
          registry and any past runs.
        </p>
      </div>
    </div>
  );
}
