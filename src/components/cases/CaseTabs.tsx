'use client';

import {
  Calendar,
  CheckCircle2,
  ExternalLink,
  Files,
  FileText,
  Hash,
  Mail,
  MessageCircle,
  NotebookPen,
  Scan,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  CASE_STATUS_LABEL,
  CASE_TYPE_LABEL,
  type Case,
  type Client,
  type SendConfig,
  SOURCE_KIND_LABEL,
  type Source,
  type SourceKind,
} from '@/data/cases';
import { TOOLS } from '@/lib/tools/registry';
import AddNoteButton from './AddNoteButton';
import PasteButton from './PasteButton';
import RegenerateSummaryButton from './RegenerateSummaryButton';
import SourceActions from './SourceActions';
import ToolRunner from './ToolRunner';
import UploadButton from './UploadButton';

type TabId = 'overview' | 'sources' | 'tools';
const TAB_IDS: readonly TabId[] = ['overview', 'sources', 'tools'] as const;
const DEFAULT_TAB: TabId = 'overview';

interface Props {
  caseData: Case;
  client: Client | undefined;
  send: SendConfig;
}

export default function CaseTabs({ caseData, client, send }: Props) {
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
      {activeTab === 'sources' && <SourcesTab caseId={caseData.id} sources={caseData.sources} />}
      {activeTab === 'tools' && <ToolsTab caseData={caseData} send={send} />}
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
    <div role="tablist" className="tabs tabs-lift">
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

      {/* AI case summary card — rolled up across sources by Haiku. */}
      <div className="card bg-base-100 border border-base-300">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="card-title text-base gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Case summary
            </h2>
            <RegenerateSummaryButton
              caseId={caseData.id}
              hasSummary={Boolean(caseData.aiSummary)}
            />
          </div>
          {caseData.aiSummary ? (
            <>
              <p className="text-base-content/80 leading-relaxed text-sm">{caseData.aiSummary}</p>
              {caseData.aiSummaryGeneratedAt && (
                <p className="text-xs text-base-content/40 mt-1">
                  AI-generated · updated {formatShortDate(caseData.aiSummaryGeneratedAt)}
                </p>
              )}
            </>
          ) : (
            <p className="text-base-content/50 italic text-sm">
              Case summary will appear here once sources have been added and analysed. Click
              Generate to roll up the source summaries.
            </p>
          )}

          {/* Lawyer-authored note, shown separately when present. */}
          {caseData.summary && (
            <div className="mt-3 pt-3 border-t border-base-200">
              <p className="text-xs uppercase tracking-wide text-base-content/50 mb-1">
                Solicitor note
              </p>
              <p className="text-base-content/80 leading-relaxed text-sm">{caseData.summary}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Sources tab ----------------------------------------------------------

const SOURCES_PAGE_SIZE = 10;

function SourcesTab({ caseId, sources }: { caseId: string; sources: Source[] }) {
  const [kind, setKind] = useState<SourceKind | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  // Kinds actually present on this case — drives the type dropdown so
  // we don't offer empty filters.
  const kindsPresent = useMemo(() => {
    const set = new Set<SourceKind>();
    for (const s of sources) set.add(s.kind);
    return Array.from(set);
  }, [sources]);

  // Apply the type + date-range filters. Date filters compare on the
  // source's received date (YYYY-MM-DD); undated sources are excluded
  // only when a date filter is active.
  const filtered = useMemo(() => {
    return sources.filter((s) => {
      if (kind !== 'all' && s.kind !== kind) return false;
      if (from || to) {
        if (!s.sourceReceivedAt) return false;
        const d = s.sourceReceivedAt.slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      return true;
    });
  }, [sources, kind, from, to]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / SOURCES_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (currentPage - 1) * SOURCES_PAGE_SIZE,
    currentPage * SOURCES_PAGE_SIZE,
  );

  // Changing a filter resets to the first page.
  const onKind = (v: SourceKind | 'all') => {
    setKind(v);
    setPage(1);
  };
  const onFrom = (v: string) => {
    setFrom(v);
    setPage(1);
  };
  const onTo = (v: string) => {
    setTo(v);
    setPage(1);
  };
  const clearFilters = () => {
    setKind('all');
    setFrom('');
    setTo('');
    setPage(1);
  };
  const filtersActive = kind !== 'all' || from !== '' || to !== '';

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <h2 className="card-title text-base">
            Sources
            <span className="badge badge-ghost badge-sm">{sources.length}</span>
          </h2>
          <div className="flex items-center gap-2">
            <AddNoteButton caseId={caseId} />
            <PasteButton caseId={caseId} />
            <UploadButton caseId={caseId} />
          </div>
        </div>

        {sources.length === 0 ? (
          <div className="text-center py-10 text-base-content/50">
            <Files className="h-8 w-8 mx-auto mb-2 text-base-content/30" />
            <p>No sources yet — upload files, add notes, or paste WhatsApp / email content.</p>
          </div>
        ) : (
          <>
            {/* Filter bar */}
            <div className="flex flex-wrap items-end gap-3 mt-1 mb-2">
              <label className="form-control">
                <span className="label-text text-xs text-base-content/60 pb-0.5">Type</span>
                <select
                  className="select select-bordered select-sm"
                  value={kind}
                  onChange={(e) => onKind(e.target.value as SourceKind | 'all')}
                >
                  <option value="all">All types</option>
                  {kindsPresent.map((k) => (
                    <option key={k} value={k}>
                      {SOURCE_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-control">
                <span className="label-text text-xs text-base-content/60 pb-0.5">From</span>
                <input
                  type="date"
                  className="input input-bordered input-sm"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => onFrom(e.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text text-xs text-base-content/60 pb-0.5">To</span>
                <input
                  type="date"
                  className="input input-bordered input-sm"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => onTo(e.target.value)}
                />
              </label>
              {filtersActive && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
                  Clear
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="text-center py-8 text-base-content/50">
                <p>No sources match the current filters.</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {pageItems.map((src) => (
                    <SourceRow key={src.id} source={src} />
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-base-content/50">
                      Showing {(currentPage - 1) * SOURCES_PAGE_SIZE + 1}–
                      {Math.min(currentPage * SOURCES_PAGE_SIZE, filtered.length)} of{' '}
                      {filtered.length}
                    </span>
                    <div className="join">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                        <input
                          key={n}
                          type="radio"
                          name="sources-page"
                          aria-label={String(n)}
                          className="join-item btn btn-sm btn-square"
                          checked={currentPage === n}
                          onChange={() => setPage(n)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SourceRow({ source }: { source: Source }) {
  const Icon = SOURCE_KIND_ICON[source.kind];
  return (
    <details className="collapse collapse-arrow bg-base-100 border border-base-300">
      <summary className="collapse-title !py-3 min-h-0 pr-10 cursor-pointer">
        <div className="flex items-start gap-3">
          <Icon className="h-4 w-4 shrink-0 text-base-content/50 mt-1" />
          <div className="min-w-0 flex-1 flex flex-col gap-2">
            {/* Top row: title (left) · status labels (right) */}
            <div className="flex items-start justify-between gap-3">
              <span className="font-medium min-w-0 line-clamp-2 break-words">{source.title}</span>
              <div className="flex items-center gap-2 shrink-0">
                {source.metadata?.origin === 'outlook' && (
                  <span
                    className="badge badge-outline badge-xs gap-1"
                    title="Imported from Outlook"
                  >
                    <Mail className="h-3 w-3" />
                    Outlook
                  </span>
                )}
                <SourceStatusBadge status={source.status} />
              </div>
            </div>
            {/* Bottom row: type · date (left) · actions (right) */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-base-content/60 whitespace-nowrap">
                {SOURCE_KIND_LABEL[source.kind]}
                {source.sourceReceivedAt && ` · ${formatShortDate(source.sourceReceivedAt)}`}
              </span>
              <SourceActions sourceId={source.id} status={source.status} />
            </div>
          </div>
        </div>
      </summary>
      <div className="collapse-content !pb-3 space-y-2 text-sm">
        <SourceMeta metadata={source.metadata} />
        {source.hasFile && <FileCard source={source} />}
        {source.status === 'failed' && source.errorMessage && (
          <div className="alert alert-error text-xs py-2">
            <span>
              Summary failed: {source.errorMessage}. Use the retry button above to try again.
            </span>
          </div>
        )}
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
        ) : source.status === 'processing' ? (
          <p className="text-base-content/50 italic">
            AI summary will appear here once the source is processed.
          </p>
        ) : source.status === 'ready' ? (
          <p className="text-base-content/50 italic">
            {source.hasFile
              ? "No AI summary — this file type isn't auto-summarised. Open the file to view it."
              : 'No AI summary for this source.'}
          </p>
        ) : null}
      </div>
    </details>
  );
}

// File-specific block for `file` / `scan` sources: type · size and an
// "Open file" link that streams the private blob through the server.
function FileCard({ source }: { source: Source }) {
  const meta = source.metadata ?? {};
  const mime = meta.mime_type;
  const size = meta.size_bytes ? formatBytes(Number(meta.size_bytes)) : undefined;
  const Icon = SOURCE_KIND_ICON[source.kind];
  return (
    <div className="flex items-center gap-3 rounded-md border border-base-200 bg-base-200/40 p-2.5">
      <Icon className="h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{meta.filename ?? source.title}</p>
        <p className="text-xs text-base-content/60">
          {[mime, size].filter(Boolean).join(' · ') || 'File'}
        </p>
      </div>
      <a
        href={`/api/sources/${source.id}`}
        target="_blank"
        rel="noreferrer"
        className="btn btn-xs btn-outline gap-1 shrink-0"
      >
        <ExternalLink className="h-3 w-3" />
        Open file
      </a>
    </div>
  );
}

// Human-readable byte size for file metadata (e.g. "37.5 KB").
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

// Renders the correspondence metadata stored on email / WhatsApp
// sources (from / subject / from_phone). Files carry mime_type /
// size_bytes which we don't surface here. Renders nothing when there's
// no metadata or none of the known keys are present.
function SourceMeta({ metadata }: { metadata?: Record<string, string | undefined> }) {
  if (!metadata) return null;
  const rows: Array<[string, string]> = [];
  if (metadata.from) rows.push(['From', metadata.from]);
  if (metadata.subject) rows.push(['Subject', metadata.subject]);
  if (metadata.from_phone) rows.push(['Phone', metadata.from_phone]);
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs text-base-content/70">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-base-content/50">{label}</dt>
          <dd className="truncate">{value}</dd>
        </div>
      ))}
    </dl>
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
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// --- Tools tab ------------------------------------------------------------

function ToolsTab({ caseData, send }: { caseData: Case; send: SendConfig }) {
  // Group tools by category for a tidier list as the registry grows.
  const grouped = TOOLS.reduce<Record<string, typeof TOOLS>>((acc, t) => {
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

  // Ready sources are the selectable context for a generation.
  const readySources = caseData.sources
    .filter((s) => s.status === 'ready')
    .map((s) => ({ id: s.id, title: s.title, kind: s.kind }));

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
                          {latest.sentAt && (
                            <span className="flex items-center gap-1 text-success">
                              <Mail className="h-3 w-3" />
                              Sent
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <ToolRunner
                      caseId={caseData.id}
                      caseTitle={caseData.title}
                      toolId={t.id}
                      toolLabel={t.label}
                      latest={latest}
                      sources={readySources}
                      send={send}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <p className="text-xs text-base-content/50 mt-4">
          Each tool drafts with Opus from the case summary and selected sources; refine the draft by
          chat in the run dialog.
        </p>
      </div>
    </div>
  );
}
