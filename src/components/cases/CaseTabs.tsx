'use client';

import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardList,
  ExternalLink,
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
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Fragment, useEffect, useMemo, useState } from 'react';
import {
  CASE_STATUS_LABEL,
  CASE_TYPE_LABEL,
  type Case,
  type CaseFactGroup,
  type CaseFactView,
  type CaseTaskView,
  type CaseType,
  type Client,
  type EvidenceCheck,
  type SendConfig,
  SOURCE_KIND_LABEL,
  type Source,
  type SourceKind,
} from '@/data/cases';
import { formatMoneyDisplay } from '@/lib/format';
import { TOOLS } from '@/lib/tools/registry';
import AddNoteButton from './AddNoteButton';
import CaseReferences from './CaseReferences';
import PasteButton from './PasteButton';
import ReanalyzeCaseButton from './ReanalyzeCaseButton';
import RegenerateSummaryButton from './RegenerateSummaryButton';
import SourceActions from './SourceActions';
import ToolRunner from './ToolRunner';
import UploadButton from './UploadButton';

type TabId = 'overview' | 'sources' | 'facts' | 'tools';
const TAB_IDS: readonly TabId[] = ['overview', 'sources', 'facts', 'tools'] as const;
const DEFAULT_TAB: TabId = 'overview';

interface Props {
  caseData: Case;
  client: Client | undefined;
  send: SendConfig;
  facts: CaseFactGroup[];
  // Each source's own extracted facts, keyed by source id.
  factsBySource: Record<string, CaseFactView[]>;
  // Suggested evidence checklist for the case's route, marked against facts.
  evidence: EvidenceCheck[];
  // The case's task list (Action plan) — stateful, seeded from action items.
  tasks: CaseTaskView[];
}

export default function CaseTabs({
  caseData,
  client,
  send,
  facts,
  factsBySource,
  evidence,
  tasks,
}: Props) {
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

  const tabs: Array<{ id: TabId; label: string; badge?: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'sources', label: 'Sources', badge: String(caseData.sources.length) },
    { id: 'facts', label: 'Facts' },
    { id: 'tools', label: 'Tools' },
  ];

  // daisyUI tabs-lift: each tab is followed by its tab-content panel, so
  // the active tab merges into the content as one piece. Only the active
  // tab's panel is rendered (its adjacency to the active tab is what
  // makes daisyUI show it; `order:1; width:100%` lays it out below the
  // tab row).
  return (
    <div role="tablist" className="tabs tabs-lift">
      {tabs.map((t) => {
        const isActive = t.id === activeTab;
        return (
          <Fragment key={t.id}>
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t.id)}
              className={`tab gap-2 ${isActive ? 'tab-active font-semibold' : ''}`}
            >
              {t.label}
              {t.badge && <span className="badge badge-ghost badge-sm">{t.badge}</span>}
            </button>
            {isActive && (
              <div role="tabpanel" className="tab-content bg-base-100 border-base-300 p-4 sm:p-6">
                {t.id === 'overview' && <OverviewTab caseData={caseData} client={client} />}
                {t.id === 'sources' && (
                  <SourcesTab
                    caseId={caseData.id}
                    sources={caseData.sources}
                    factsBySource={factsBySource}
                  />
                )}
                {t.id === 'facts' && (
                  <FactsTab
                    caseId={caseData.id}
                    groups={facts}
                    evidence={evidence}
                    caseType={caseData.caseType}
                    tasks={tasks}
                    deadline={caseData.deadline}
                    sources={caseData.sources}
                  />
                )}
                {t.id === 'tools' && <ToolsTab caseData={caseData} send={send} />}
              </div>
            )}
          </Fragment>
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

      {/* Matter references — inline-editable; feed the drafting tools. */}
      <CaseReferences
        caseId={caseData.id}
        ourReference={caseData.ourReference}
        yourReference={caseData.yourReference}
      />

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

function SourcesTab({
  caseId,
  sources,
  factsBySource,
}: {
  caseId: string;
  sources: Source[];
  factsBySource: Record<string, CaseFactView[]>;
}) {
  const [kind, setKind] = useState<SourceKind | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  // Source jumped to via a fact's provenance link (#source-<id>). We open
  // it, clear filters and page to it so it's actually visible.
  const [targetId, setTargetId] = useState<string | null>(null);

  // Read the #source-<id> hash on mount and whenever it changes.
  useEffect(() => {
    const readHash = () => {
      const m = window.location.hash.match(/^#source-(.+)$/);
      setTargetId(m ? m[1] : null);
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  // Clear filters and page to the target so its row renders, then scroll.
  useEffect(() => {
    if (!targetId) return;
    const idx = sources.findIndex((s) => s.id === targetId);
    if (idx === -1) return;
    setKind('all');
    setFrom('');
    setTo('');
    setPage(Math.floor(idx / SOURCES_PAGE_SIZE) + 1);
  }, [targetId, sources]);

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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="card-title text-base">
          Sources
          <span className="badge badge-ghost badge-sm">{sources.length}</span>
        </h2>
        <div className="flex items-center gap-2">
          <ReanalyzeCaseButton caseId={caseId} sourceCount={sources.length} />
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
                  <SourceRow
                    key={src.id}
                    source={src}
                    facts={factsBySource[src.id] ?? []}
                    defaultOpen={src.id === targetId}
                  />
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
  );
}

// Short tags for the per-source fact badges (compact vs the Facts tab labels).
const FACT_TYPE_SHORT: Record<string, string> = {
  party: 'party',
  date: 'date',
  address: 'address',
  reference: 'ref',
  money: 'money',
  evidence: 'evidence',
  key_fact: 'fact',
  action_item: 'action',
  document_type: 'doc',
};

// Free-text fact values come out of extraction lowercase-ish (e.g.
// "council tax bill"); show them with a leading capital. Names, refs,
// dates and money are left untouched (already formatted / not prose).
const CAPITALISE_FACT_TYPES = new Set(['evidence', 'key_fact', 'action_item', 'document_type']);
function factDisplayValue(f: CaseFactView): string {
  const v = f.value ?? '';
  if (f.type === 'money') return formatMoneyDisplay(v);
  if (!v || !CAPITALISE_FACT_TYPES.has(f.type)) return v;
  return v.charAt(0).toUpperCase() + v.slice(1);
}

// Display a fact's key/label (party role, reference kind, money label, …)
// with a leading capital and underscores as spaces: "home_office" ->
// "Home office", "applicant" -> "Applicant".
function formatFactLabel(label: string): string {
  const t = label.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Action-item priority (stored in CaseFactView.label) → badge colour +
// sort order, so the lawyer sees the high-priority follow-ups first.
const PRIORITY_BADGE: Record<string, string> = {
  high: 'badge-error',
  medium: 'badge-warning',
  low: 'badge-ghost',
};
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
function sortByPriority(facts: CaseFactView[]): CaseFactView[] {
  return [...facts].sort(
    (a, b) => (PRIORITY_RANK[a.label ?? ''] ?? 3) - (PRIORITY_RANK[b.label ?? ''] ?? 3),
  );
}

function SourceRow({
  source,
  facts,
  defaultOpen,
}: {
  source: Source;
  facts: CaseFactView[];
  defaultOpen?: boolean;
}) {
  const Icon = SOURCE_KIND_ICON[source.kind];
  const [open, setOpen] = useState(defaultOpen ?? false);
  // When navigated to via a provenance link, open it and scroll to it.
  useEffect(() => {
    if (!defaultOpen) return;
    setOpen(true);
    document
      .getElementById(`source-${source.id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [defaultOpen, source.id]);
  return (
    <details
      id={`source-${source.id}`}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="collapse collapse-arrow bg-base-100 border border-base-300 scroll-mt-20"
    >
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
                {source.metadata?.origin === 'client-upload' && (
                  <span
                    className="badge badge-outline badge-xs gap-1"
                    title="Uploaded by the client via a secure link"
                  >
                    <Upload className="h-3 w-3" />
                    Client upload
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

        {/* Structured facts extracted from this source (Pass 1). */}
        {facts.length > 0 && (
          <div className="rounded-md border border-base-200 bg-base-200/40 p-3">
            <p className="text-xs uppercase tracking-wide text-base-content/50 mb-1.5 flex items-center gap-1">
              <ClipboardList className="h-3 w-3 text-primary" /> Extracted facts ({facts.length})
            </p>
            <ul className="space-y-1">
              {facts.map((f) => (
                <li key={f.id} className="flex items-baseline gap-1.5">
                  <span className="badge badge-ghost badge-xs shrink-0">
                    {FACT_TYPE_SHORT[f.type] ?? f.type}
                  </span>
                  {f.type === 'date' && f.factDate && (
                    <span className="font-mono text-xs text-base-content/60 shrink-0">
                      {f.factDate}
                    </span>
                  )}
                  {/* Typed facts (money/ref/party/address) carry a label —
                      a bare "£148.20" or "AB123456C" is meaningless without
                      it. Show "Label: value" as the grouped Facts view does. */}
                  {(f.type === 'party' ||
                    f.type === 'reference' ||
                    f.type === 'address' ||
                    f.type === 'money') &&
                    f.label && (
                      <span className="text-base-content/50 shrink-0">
                        {formatFactLabel(f.label)}:
                      </span>
                    )}
                  <span className="text-base-content/80 break-words">{factDisplayValue(f)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
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

// --- Facts tab ------------------------------------------------------------

// Read-only view of the structured facts extracted from the case's
// sources (Pass 1). Grouped by category, each fact carries its source as
// provenance and a confidence badge when below 'high'.
// Suggested evidence checklist for the case's route, marked present/absent
// against the extracted facts. Decision-support, not legal advice.
function EvidenceChecklistCard({
  evidence,
  caseType,
}: {
  evidence: EvidenceCheck[];
  caseType: CaseType;
}) {
  if (evidence.length === 0) return null;
  const present = evidence.filter((e) => e.present).length;
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="card-title text-sm gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            Evidence checklist — {CASE_TYPE_LABEL[caseType]}
          </h3>
          <span className="text-xs text-base-content/50 shrink-0">
            {present}/{evidence.length} evidenced
          </span>
        </div>
        <p className="text-xs text-base-content/40 -mt-1">
          Suggested evidence for this route, matched against extracted facts. Review against the
          current Immigration Rules — not legal advice.
        </p>
        <ul className="mt-1 space-y-1">
          {evidence.map((e) => (
            <li key={e.label} className="flex items-start gap-2 text-sm">
              {e.present ? (
                <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
              ) : (
                <Circle className="h-4 w-4 text-base-content/30 shrink-0 mt-0.5" />
              )}
              <span className={e.present ? 'text-base-content/80' : 'text-base-content/60'}>
                {e.label}
                {!e.present && <span className="text-warning text-xs ml-2">missing</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Valid tool ids — so a stale suggestedToolId can't link to a missing tool.
const TOOL_ID_SET = new Set(TOOLS.map((t) => t.id));

// The Tool a task can launch, if any — drives the per-task action button.
// request_documents always routes to Request Documents; a draft_document
// uses the classifier's suggested tool when it's a real one.
function taskToolAction(task: CaseTaskView): { toolId: string; label: string } | null {
  if (task.status !== 'open') return null;
  if (task.kind === 'request_documents') {
    const toolId =
      task.suggestedToolId && TOOL_ID_SET.has(task.suggestedToolId)
        ? task.suggestedToolId
        : 'request-documents';
    return TOOL_ID_SET.has(toolId) ? { toolId, label: 'Request documents' } : null;
  }
  if (
    task.kind === 'draft_document' &&
    task.suggestedToolId &&
    TOOL_ID_SET.has(task.suggestedToolId)
  ) {
    return { toolId: task.suggestedToolId, label: 'Draft' };
  }
  return null;
}

// One task row — a checkbox to toggle done, the priority badge, the text, an
// optional action button that launches the matching Tool, and a hover-× to
// dismiss. Done rows strike through.
function TaskRow({
  task,
  onToggle,
  onDismiss,
  actionLabel,
  onAction,
}: {
  task: CaseTaskView;
  onToggle: () => void;
  onDismiss: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const done = task.status === 'done';
  return (
    <li className="group flex items-start gap-2 text-sm py-1.5">
      <input
        type="checkbox"
        checked={done}
        onChange={onToggle}
        aria-label={done ? 'Mark not done' : 'Mark done'}
        className="checkbox checkbox-xs mt-0.5 shrink-0"
      />
      <span className="w-14 shrink-0 mt-0.5">
        <span className={`badge badge-xs ${PRIORITY_BADGE[task.priority] ?? 'badge-ghost'}`}>
          {task.priority}
        </span>
      </span>
      <span
        className={`flex-1 ${done ? 'line-through text-base-content/40' : 'text-base-content/80'}`}
      >
        {task.text}
      </span>
      {task.origin === 'manual' && (
        <span className="badge badge-ghost badge-xs shrink-0 mt-0.5">added</span>
      )}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="btn btn-ghost btn-xs gap-1 shrink-0 text-primary"
        >
          <Sparkles className="h-3 w-3" />
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss task"
        aria-label="Dismiss task"
        className="opacity-0 group-hover:opacity-100 hover:text-error shrink-0 mt-0.5"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

// Whole days from today (local) to an ISO date (YYYY-MM-DD): positive =
// future, 0 = today, negative = overdue; null if absent/unparseable.
function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const due = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

// Deadline urgency → label + tone. Red within a week or overdue, amber
// within a fortnight, muted when no deadline is set.
function deadlineSummary(days: number | null): { text: string; tone: string } {
  if (days === null) return { text: 'No deadline set', tone: 'text-base-content/40' };
  if (days < 0) {
    const n = Math.abs(days);
    return { text: `Overdue by ${n} day${n === 1 ? '' : 's'}`, tone: 'text-error font-medium' };
  }
  if (days === 0) return { text: 'Due today', tone: 'text-error font-medium' };
  const text = `Due in ${days} day${days === 1 ? '' : 's'}`;
  if (days <= 7) return { text, tone: 'text-error font-medium' };
  if (days <= 14) return { text, tone: 'text-warning' };
  return { text, tone: 'text-base-content/60' };
}

// Action plan — the case's task list. Seeded from the consolidated action
// items but now stateful: check items off (persisted), dismiss noise, add
// your own. A deadline-aware summary line surfaces what blocks submission
// and how long is left.
function ActionPlanCard({
  caseId,
  tasks,
  deadline,
}: {
  caseId: string;
  tasks: CaseTaskView[];
  deadline?: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<CaseTaskView[]>(tasks);
  // Re-sync when the server sends a fresh list (after refresh / reanalyze).
  useEffect(() => setItems(tasks), [tasks]);
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const open = items.filter((t) => t.status === 'open');
  const done = items.filter((t) => t.status === 'done');

  async function patch(id: string, status: 'open' | 'done' | 'dismissed') {
    setItems((prev) =>
      status === 'dismissed'
        ? prev.filter((t) => t.id !== id)
        : prev.map((t) => (t.id === id ? { ...t, status } : t)),
    );
    try {
      await fetch(`/api/cases/${caseId}/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    } finally {
      router.refresh();
    }
  }

  async function addTask(e: FormEvent) {
    e.preventDefault();
    const text = newText.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json().catch(() => ({}))) as { task?: CaseTaskView };
      if (res.ok && data.task) {
        const task = data.task;
        setItems((prev) => [...prev.filter((t) => t.id !== task.id), task]);
        setNewText('');
        setAdding(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  // High-priority open tasks are the ones the consolidation flagged as
  // blocking the application — surface them against the case deadline.
  const blocking = open.filter((t) => t.priority === 'high').length;
  const summary = deadlineSummary(daysUntil(deadline));
  const showSummary = open.length > 0 && (deadline != null || blocking > 0);

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="card-title text-sm gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            Action plan
            {open.length > 0 && <span className="badge badge-ghost badge-sm">{open.length}</span>}
          </h3>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="btn btn-ghost btn-xs gap-1"
          >
            <Plus className="h-3 w-3" />
            Add task
          </button>
        </div>

        {showSummary && (
          <div className="flex items-center gap-2 text-xs -mt-1">
            {blocking > 0 && (
              <span className="text-error font-medium">{blocking} blocking submission</span>
            )}
            {blocking > 0 && deadline != null && <span className="text-base-content/30">·</span>}
            {deadline != null && (
              <span className={`flex items-center gap-1 ${summary.tone}`}>
                <Calendar className="h-3 w-3" />
                {summary.text}
              </span>
            )}
          </div>
        )}

        {adding && (
          <form onSubmit={addTask} className="flex items-center gap-2">
            <input
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Add a task…"
              className="input input-bordered input-sm flex-1"
            />
            <button
              type="submit"
              disabled={busy || !newText.trim()}
              className="btn btn-primary btn-sm"
            >
              Add
            </button>
          </form>
        )}

        {open.length === 0 && done.length === 0 ? (
          <p className="text-sm text-base-content/50 italic">No outstanding actions.</p>
        ) : (
          <ul className="mt-1 divide-y divide-base-200">
            {open.map((t) => {
              const action = taskToolAction(t);
              return (
                <TaskRow
                  key={t.id}
                  task={t}
                  onToggle={() => patch(t.id, 'done')}
                  onDismiss={() => patch(t.id, 'dismissed')}
                  actionLabel={action?.label}
                  onAction={
                    action ? () => router.push(`?tab=tools&run=${action.toolId}`) : undefined
                  }
                />
              );
            })}
          </ul>
        )}

        {done.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="text-xs text-base-content/50 hover:text-base-content/70"
            >
              {showDone ? 'Hide' : 'Show'} {done.length} completed
            </button>
            {showDone && (
              <ul className="mt-1 divide-y divide-base-200">
                {done.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={() => patch(t.id, 'open')}
                    onDismiss={() => patch(t.id, 'dismissed')}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Provenance line under a fact: links to the source it came from — opens
// the document for file/scan sources, otherwise jumps to that source in
// the Sources tab. Merged facts ("N sources") stay plain text.
function FactProvenance({ fact, source }: { fact: CaseFactView; source?: Source }) {
  const cls = 'block text-xs text-base-content/40 truncate';
  if (fact.merged || !source) {
    return (
      <span className={cls} title={fact.sourceTitle}>
        from {fact.sourceTitle}
      </span>
    );
  }
  if (source.hasFile) {
    return (
      <a
        href={`/api/sources/${fact.sourceId}`}
        target="_blank"
        rel="noreferrer"
        className={`${cls} link link-hover hover:text-base-content/70`}
        title={`Open ${fact.sourceTitle}`}
      >
        from {fact.sourceTitle} ↗
      </a>
    );
  }
  return (
    <Link
      href={`?tab=sources#source-${fact.sourceId}`}
      scroll
      className={`${cls} link link-hover hover:text-base-content/70`}
      title={`Go to ${fact.sourceTitle}`}
    >
      from {fact.sourceTitle}
    </Link>
  );
}

// --- Fact tiering (Phase 1: type + confidence heuristic) ------------------
// A flat list reads as undifferentiated noise: "Applicant: Daniel Okafor"
// (metadata) and "Financial requirement met" (an outcome-determining
// conclusion) render with identical weight, so the eye can't triage. Until
// facts carry an LLM-assigned significance, we tier them by TYPE as a first
// cut — conclusions on top, corroborating detail below, bare metadata tucked
// away and collapsed. A low-confidence extraction is never elevated.
type FactTier = 'critical' | 'supporting' | 'raw';

const TYPE_TIER: Record<string, FactTier> = {
  key_fact: 'critical',
  action_item: 'critical',
  money: 'supporting',
  date: 'supporting',
  address: 'supporting',
  party: 'raw',
  reference: 'raw',
  document_type: 'raw',
};

function factTier(f: CaseFactView): FactTier {
  const base = TYPE_TIER[f.type] ?? 'raw';
  // Don't let an uncertain extraction headline the case.
  if (f.confidence === 'low' && base === 'critical') return 'supporting';
  return base;
}

// A fact's inline content (date prefix / priority badge / "Label:" / value),
// without provenance — shared by the row view and the by-source bullet view.
function FactContent({ f }: { f: CaseFactView }) {
  return (
    <span>
      {f.type === 'date' && f.factDate && (
        <span className="font-mono text-base-content/60 mr-2">{f.factDate}</span>
      )}
      {f.type === 'action_item' && f.label && (
        <span
          className={`badge badge-xs mr-1.5 align-middle ${PRIORITY_BADGE[f.label] ?? 'badge-ghost'}`}
        >
          {f.label}
        </span>
      )}
      {(f.type === 'party' ||
        f.type === 'reference' ||
        f.type === 'address' ||
        f.type === 'money') &&
        f.label && <span className="text-base-content/50 mr-1">{formatFactLabel(f.label)}:</span>}
      <span className="text-base-content/90">{factDisplayValue(f)}</span>
    </span>
  );
}

// One fact row with its own provenance line — used by Supporting / Raw,
// where facts are grouped by type rather than by source.
function FactRow({ f, source }: { f: CaseFactView; source?: Source }) {
  return (
    <li className="py-1.5 text-sm">
      <div className="min-w-0">
        <FactContent f={f} />
        <FactProvenance fact={f} source={source} />
      </div>
    </li>
  );
}

// Clickable source title used as a heading when facts are grouped by source
// (Critical tier). Mirrors FactProvenance's link behaviour: opens the file
// for file/scan sources, else jumps to the source in the Sources tab; merged
// facts ("N sources") stay plain text.
function SourceHeading({
  title,
  sourceId,
  merged,
  source,
}: {
  title: string;
  sourceId: string;
  merged: boolean;
  source?: Source;
}) {
  const cls = 'text-xs font-medium uppercase tracking-wide text-base-content/55 truncate';
  if (merged || !source) {
    return (
      <span className={cls} title={title}>
        {title}
      </span>
    );
  }
  if (source.hasFile) {
    return (
      <a
        href={`/api/sources/${sourceId}`}
        target="_blank"
        rel="noreferrer"
        className={`${cls} link link-hover hover:text-base-content/80`}
        title={`Open ${title}`}
      >
        {title} ↗
      </a>
    );
  }
  return (
    <Link
      href={`?tab=sources#source-${sourceId}`}
      scroll
      className={`${cls} link link-hover hover:text-base-content/80`}
      title={`Go to ${title}`}
    >
      {title}
    </Link>
  );
}

// Render a tier's facts grouped BY SOURCE: one heading per document with its
// related facts as bullets underneath — so the source is named once instead
// of repeated on every row. Used for Critical facts.
function FactsBySource({
  groups,
  sourceById,
}: {
  groups: CaseFactGroup[];
  sourceById: Map<string, Source>;
}) {
  // Flatten the tier's type-subgroups, then regroup by source (first-seen
  // order). Merged facts ("N sources") bucket by their title.
  const bySource = new Map<
    string,
    { title: string; sourceId: string; merged: boolean; facts: CaseFactView[] }
  >();
  for (const g of groups) {
    for (const f of g.facts) {
      const key = f.merged ? `merged:${f.sourceTitle}` : f.sourceId;
      let entry = bySource.get(key);
      if (!entry) {
        entry = { title: f.sourceTitle, sourceId: f.sourceId, merged: !!f.merged, facts: [] };
        bySource.set(key, entry);
      }
      entry.facts.push(f);
    }
  }
  return (
    <div className="space-y-3">
      {[...bySource.values()].map((entry) => (
        <div key={entry.merged ? `m:${entry.title}` : entry.sourceId}>
          <SourceHeading
            title={entry.title}
            sourceId={entry.sourceId}
            merged={entry.merged}
            source={sourceById.get(entry.sourceId)}
          />
          <ul className="mt-1 space-y-1">
            {entry.facts.map((f) => (
              <li key={f.id} className="flex gap-2 text-sm">
                <span className="text-primary/60 select-none leading-6">•</span>
                <FactContent f={f} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// The type-subgroups within a tier (e.g. "Money", "Key dates"), each a small
// labelled list. The tier wrapper supplies the surrounding card/accent.
function FactGroupBlocks({
  groups,
  sourceById,
  labelClass,
}: {
  groups: CaseFactGroup[];
  sourceById: Map<string, Source>;
  labelClass?: string;
}) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.type}>
          <p className={`text-xs uppercase tracking-wide ${labelClass ?? 'text-base-content/50'}`}>
            {group.label}
          </p>
          <ul className="divide-y divide-base-200">
            {(group.type === 'action_item' ? sortByPriority(group.facts) : group.facts).map((f) => (
              <FactRow key={f.id} f={f} source={sourceById.get(f.sourceId)} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

// Split a tier's facts into type-subgroups, preserving the source group order
// and labels. A whole type usually lands in one tier, but low-confidence
// demotion can split a type across tiers — so we rebuild groups per tier.
function groupsForTier(displayGroups: CaseFactGroup[], tier: FactTier): CaseFactGroup[] {
  const byType = new Map<string, CaseFactGroup>();
  for (const g of displayGroups) {
    for (const f of g.facts) {
      if (factTier(f) !== tier) continue;
      let grp = byType.get(g.type);
      if (!grp) {
        grp = { type: g.type, label: g.label, facts: [] };
        byType.set(g.type, grp);
      }
      grp.facts.push(f);
    }
  }
  return [...byType.values()];
}

function FactsTab({
  caseId,
  groups,
  evidence,
  caseType,
  tasks,
  deadline,
  sources,
}: {
  caseId: string;
  groups: CaseFactGroup[];
  evidence: EvidenceCheck[];
  caseType: CaseType;
  tasks: CaseTaskView[];
  deadline?: string;
  sources: Source[];
}) {
  const total = groups.reduce((n, g) => n + g.facts.length, 0);
  // Once tasks exist, drop the raw per-source action_item group (the Action
  // plan now covers them).
  const hasTasks = tasks.length > 0;
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  // Drop the standalone Evidence group (the checklist above covers it), and
  // the raw per-source action_item group when the task list covers it.
  const displayGroups = groups.filter(
    (g) => g.type !== 'evidence' && !(g.type === 'action_item' && hasTasks),
  );

  // Tier the facts so the page has a hierarchy instead of one flat wall.
  const critical = useMemo(() => groupsForTier(displayGroups, 'critical'), [displayGroups]);
  const supporting = useMemo(() => groupsForTier(displayGroups, 'supporting'), [displayGroups]);
  const raw = useMemo(() => groupsForTier(displayGroups, 'raw'), [displayGroups]);
  const rawCount = raw.reduce((n, g) => n + g.facts.length, 0);

  return (
    <div className="flex flex-col gap-3">
      <EvidenceChecklistCard evidence={evidence} caseType={caseType} />
      <ActionPlanCard caseId={caseId} tasks={tasks} deadline={deadline} />

      <div className="flex items-center justify-between">
        <h2 className="card-title text-base gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          Facts
        </h2>
        <span className="text-xs text-base-content/50">Auto-extracted from sources</span>
      </div>

      {total === 0 && (
        <p className="text-sm text-base-content/50 italic px-1">
          No facts extracted yet. Facts are pulled from each source automatically as it&apos;s added
          and analysed.
        </p>
      )}

      {/* Critical — outcome-determining conclusions. Accented so the eye
          lands here first. */}
      {critical.length > 0 && (
        <div className="card bg-primary/5 border border-primary/30">
          <div className="card-body p-4 gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Critical facts
            </p>
            <FactsBySource groups={critical} sourceById={sourceById} />
          </div>
        </div>
      )}

      {/* Supporting — corroborating detail (income, dates, addresses). */}
      {supporting.length > 0 && (
        <div className="card bg-base-100 border border-base-300">
          <div className="card-body p-4 gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
              Supporting facts
            </p>
            <FactsBySource groups={supporting} sourceById={sourceById} />
          </div>
        </div>
      )}

      {/* Raw — names, references, document types. Collapsed by default;
          rarely read, but kept one click away. */}
      {rawCount > 0 && (
        <details className="group card bg-base-100 border border-base-300">
          <summary className="card-body p-4 flex-row items-center gap-2 cursor-pointer list-none select-none">
            <ChevronRight className="h-4 w-4 text-base-content/40 transition-transform group-open:rotate-90" />
            <span className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
              Raw facts ({rawCount})
            </span>
            <span className="text-xs text-base-content/40 ml-auto">
              names, references, metadata
            </span>
          </summary>
          <div className="px-4 pb-4 space-y-3">
            <FactGroupBlocks groups={raw} sourceById={sourceById} />
          </div>
        </details>
      )}
    </div>
  );
}

// --- Tools tab ------------------------------------------------------------

function ToolsTab({ caseData, send }: { caseData: Case; send: SendConfig }) {
  // Deep-link target from the Action plan (?run=<toolId>) — auto-opens that
  // tool's run dialog. Cleared once consumed so a refresh doesn't reopen it.
  const router = useRouter();
  const searchParams = useSearchParams();
  const runToolId = searchParams.get('run');
  function clearRun() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('run');
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }

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
    <div className="flex flex-col gap-2">
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
                    template={t.template}
                    latest={latest}
                    sources={readySources}
                    send={send}
                    autoOpen={runToolId === t.id}
                    onAutoOpened={clearRun}
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
  );
}
