import { and, eq, inArray } from 'drizzle-orm';
import type { CaseFactGroup, CaseFactView } from '@/data/cases';
import { db, type Fact, type FactType, facts, sources } from '@/db/db';

// The case Facts Store — the read side. Aggregates the normalized fact
// rows across every source on a case into a deterministic, deduped view.
// Downstream generation (Pass 2: case summary, letters, missing-evidence,
// timeline) consumes THIS, never the raw sources — so identical facts
// yield identical prompts and consistent outputs.

export type { Fact };

// Stable category order for rendering. Identity first, then the
// structured facts, then free-text statements last.
const TYPE_ORDER: FactType[] = [
  'party',
  'date',
  'reference',
  'address',
  'money',
  'evidence',
  'document_type',
  'key_fact',
  'action_item',
];

const TYPE_LABEL: Record<FactType, string> = {
  party: 'Parties',
  date: 'Key dates',
  reference: 'References',
  address: 'Addresses',
  money: 'Financials',
  evidence: 'Evidence',
  document_type: 'Document types',
  key_fact: 'Key facts',
  action_item: 'Action items / gaps',
};

function rank(type: string): number {
  const i = TYPE_ORDER.indexOf(type as FactType);
  return i === -1 ? TYPE_ORDER.length : i;
}

// Deterministic multi-key sort: category, then date (ascending, so the
// timeline reads forward), then value. Stable regardless of insert order.
function sortFacts(rows: Fact[]): Fact[] {
  return [...rows].sort((a, b) => {
    const t = rank(a.type) - rank(b.type);
    if (t !== 0) return t;
    const da = a.factDate ?? '';
    const dbb = b.factDate ?? '';
    if (da !== dbb) return da < dbb ? -1 : 1;
    return (a.value ?? '').localeCompare(b.value ?? '');
  });
}

// Collapse facts that are identical across sources (same type + date +
// value). Approximate — semantic dedup ("14 Marston Rd" vs "14 Marston
// Road") is out of scope — but enough that re-stating the same fact in
// two emails doesn't appear twice. Keeps the first occurrence.
function dedupe(rows: Fact[]): Fact[] {
  const seen = new Set<string>();
  const out: Fact[] = [];
  for (const f of rows) {
    const key = `${f.type}|${f.factDate ?? ''}|${(f.value ?? '').trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

// All facts for a case (owner-scoped), sorted + deduped.
export async function getCaseFacts(caseId: string, ownerId: string): Promise<Fact[]> {
  const rows = await db
    .select()
    .from(facts)
    .where(and(eq(facts.caseId, caseId), eq(facts.ownerId, ownerId)));
  return dedupe(sortFacts(rows));
}

export interface FactGroup {
  type: FactType;
  label: string;
  facts: Fact[];
}

// Group the (already sorted/deduped) facts by category for display.
export function groupCaseFacts(rows: Fact[]): FactGroup[] {
  return TYPE_ORDER.map((type) => ({
    type,
    label: TYPE_LABEL[type],
    facts: rows.filter((f) => f.type === type),
  })).filter((g) => g.facts.length > 0);
}

function toFactView(f: Fact, titleById: Map<string, string>): CaseFactView {
  return {
    id: f.id,
    type: f.type as FactType,
    label: f.label,
    value: f.value,
    factDate: f.factDate,
    confidence: f.confidence,
    sourceId: f.sourceId,
    sourceTitle: titleById.get(f.sourceId) ?? 'Unknown source',
  };
}

// --- Near-duplicate collapse (free-text facts) ----------------------------
// Different sources phrase the same action item / evidence differently
// ("Confirm which evidence to include" vs "Clarify which evidence items
// should be included"). Exact dedup misses these, so we cluster by token
// overlap. Deterministic and cheap (no LLM) — heuristic, not perfect.

const COLLAPSE_TYPES = new Set<FactType>(['action_item', 'evidence', 'key_fact']);
const SIMILARITY_THRESHOLD = 0.5;

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'for',
  'in',
  'on',
  'with',
  'which',
  'should',
  'be',
  'is',
  'are',
  'all',
  'any',
  'from',
  'as',
  'that',
  'this',
  'it',
  'at',
  'by',
  'your',
  'our',
  'their',
  'if',
  'was',
  'were',
  'whether',
]);

// Lowercase, strip punctuation, crude-stem (drop a trailing plural/tense
// suffix so include/included/items/item collide), drop stopwords + 1-char.
function tokenize(s: string): Set<string> {
  const words = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/(ings?|ed|es|s|e)$/u, ''))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return new Set(words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
function higherPriority(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return (PRIORITY_ORDER[a] ?? 3) <= (PRIORITY_ORDER[b] ?? 3) ? a : b;
}

function collapseSimilarFacts(views: CaseFactView[]): CaseFactView[] {
  const clusters: Array<{
    rep: CaseFactView;
    tokens: Set<string>;
    sources: Set<string>;
    priority: string | null;
  }> = [];
  for (const v of views) {
    const tokens = tokenize(v.value ?? '');
    const cluster = clusters.find((c) => jaccard(c.tokens, tokens) >= SIMILARITY_THRESHOLD);
    if (cluster) {
      // Keep the most specific (most tokens) phrasing as representative.
      if (tokens.size > cluster.tokens.size) {
        cluster.rep = v;
        cluster.tokens = tokens;
      }
      cluster.sources.add(v.sourceTitle);
      cluster.priority = higherPriority(cluster.priority, v.label);
    } else {
      clusters.push({ rep: v, tokens, sources: new Set([v.sourceTitle]), priority: v.label });
    }
  }
  return clusters.map((c) => ({
    ...c.rep,
    label: c.priority ?? c.rep.label,
    // Note when the same item came from several sources.
    sourceTitle: c.sources.size > 1 ? `${c.sources.size} sources` : c.rep.sourceTitle,
  }));
}

// View model for the Facts tab: grouped facts with their source title as
// provenance, with near-duplicate free-text facts collapsed. Serializable
// (no Date columns) so it crosses the RSC → client boundary cleanly.
export async function getCaseFactsView(caseId: string, ownerId: string): Promise<CaseFactGroup[]> {
  const rows = await getCaseFacts(caseId, ownerId);
  if (rows.length === 0) return [];

  const sourceIds = [...new Set(rows.map((r) => r.sourceId))];
  const srcRows = await db
    .select({ id: sources.id, title: sources.title })
    .from(sources)
    .where(inArray(sources.id, sourceIds));
  const titleById = new Map(srcRows.map((s) => [s.id, s.title]));

  return groupCaseFacts(rows).map((group) => {
    const views = group.facts.map((f) => toFactView(f, titleById));
    return {
      type: group.type,
      label: group.label,
      facts: COLLAPSE_TYPES.has(group.type) ? collapseSimilarFacts(views) : views,
    };
  });
}

// Each source's own facts, keyed by source id — for the per-source view
// on the Sources tab. Unlike getCaseFactsView this does NOT dedupe across
// sources (every source shows the facts extracted from it), but still
// sorts by category/date for a stable order.
export async function getCaseFactsBySource(
  caseId: string,
  ownerId: string,
): Promise<Record<string, CaseFactView[]>> {
  const rows = await db
    .select()
    .from(facts)
    .where(and(eq(facts.caseId, caseId), eq(facts.ownerId, ownerId)));
  if (rows.length === 0) return {};

  const sourceIds = [...new Set(rows.map((r) => r.sourceId))];
  const srcRows = await db
    .select({ id: sources.id, title: sources.title })
    .from(sources)
    .where(inArray(sources.id, sourceIds));
  const titleById = new Map(srcRows.map((s) => [s.id, s.title]));

  const bySource: Record<string, CaseFactView[]> = {};
  for (const f of sortFacts(rows)) {
    const view: CaseFactView = {
      id: f.id,
      type: f.type as FactType,
      label: f.label,
      value: f.value,
      factDate: f.factDate,
      confidence: f.confidence,
      sourceId: f.sourceId,
      sourceTitle: titleById.get(f.sourceId) ?? 'Unknown source',
    };
    const list = bySource[f.sourceId];
    if (list) list.push(view);
    else bySource[f.sourceId] = [view];
  }
  return bySource;
}

// Render the facts as a stable, plain-text "facts sheet" for a Pass-2
// generation prompt. Deterministic ordering is the whole point — the
// same facts always produce the same sheet, so the LLM's input (and so
// its output) is consistent run to run.
export function formatCaseFactsForPrompt(rows: Fact[]): string {
  if (rows.length === 0) return '(no structured facts extracted yet)';

  const lines: string[] = [];
  for (const group of groupCaseFacts(rows)) {
    lines.push(`${group.label.toUpperCase()}:`);
    for (const f of group.facts) {
      const conf = f.confidence && f.confidence !== 'high' ? ` (${f.confidence} confidence)` : '';
      if (f.type === 'date') {
        lines.push(`- ${f.factDate ?? '?'} — ${f.value ?? ''}${conf}`);
      } else if (f.type === 'party') {
        lines.push(`- [${f.label}] ${f.value}${conf}`);
      } else if (f.type === 'reference' || f.type === 'address') {
        lines.push(`- ${f.label}: ${f.value}${conf}`);
      } else {
        lines.push(`- ${f.value}${conf}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}
