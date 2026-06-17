import { and, eq, inArray } from 'drizzle-orm';
import type { CaseFactGroup } from '@/data/cases';
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

// View model for the Facts tab: grouped facts with their source title as
// provenance. Serializable (no Date columns) so it crosses the RSC →
// client boundary cleanly.
export async function getCaseFactsView(caseId: string, ownerId: string): Promise<CaseFactGroup[]> {
  const rows = await getCaseFacts(caseId, ownerId);
  if (rows.length === 0) return [];

  const sourceIds = [...new Set(rows.map((r) => r.sourceId))];
  const srcRows = await db
    .select({ id: sources.id, title: sources.title })
    .from(sources)
    .where(inArray(sources.id, sourceIds));
  const titleById = new Map(srcRows.map((s) => [s.id, s.title]));

  return groupCaseFacts(rows).map((group) => ({
    type: group.type,
    label: group.label,
    facts: group.facts.map((f) => ({
      id: f.id,
      type: f.type as FactType,
      label: f.label,
      value: f.value,
      factDate: f.factDate,
      confidence: f.confidence,
      sourceId: f.sourceId,
      sourceTitle: titleById.get(f.sourceId) ?? 'Unknown source',
    })),
  }));
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
