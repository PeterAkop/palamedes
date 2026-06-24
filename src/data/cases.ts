// View-model types and display labels for the cases UI. Real data
// comes from the DB via `src/lib/cases/queries.ts`; sample data for
// dev seeding lives in `scripts/seed-dev.mjs`.
//
// CaseType / CaseStatus are sourced from the schema's const tuples so
// any new value lands in both the DB CHECK constraint and the TS union
// at the same time. SourceKind / GenerationStatus stay local — their
// tables don't exist yet; this file is the only declaration of those
// shapes until they do.

import type { CaseStatus, CaseType, FactType, SourceKind, SourceStatus } from '@/db/db';

export type { CaseStatus, CaseType, FactType, SourceKind, SourceStatus };

export type GenerationStatus = 'running' | 'complete' | 'failed';

export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  nationality?: string;
  preferredLanguage?: string;
}

export interface Source {
  id: string;
  kind: SourceKind;
  title: string;
  contentPreview?: string;
  sourceReceivedAt?: string;
  // Source-kind-specific extras. Loose typing here matches what the DB
  // jsonb column will hold; renderers narrow as needed.
  metadata?: Record<string, string | undefined>;
  status: SourceStatus;
  aiSummary?: string;
  // Populated only when status === 'failed'. Surfaced in the source
  // card so the lawyer can see why processing failed before retrying.
  errorMessage?: string;
  // True when a backing file is stored in Blob (uploads + email
  // attachments) — gates the "Open file" action in the UI.
  hasFile?: boolean;
}

export interface GenerationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Generation {
  id: string;
  toolId: string;
  version: number;
  status: GenerationStatus;
  model: string;
  // Token usage accumulated across the draft + refines for this run.
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  messages: GenerationMessage[];
  // Send record — present once the draft has been emailed out. `sentAt`
  // is an ISO string; `sentToClient` is false for the safe
  // lawyer-mailbox send (feature flag off) and true for a real client
  // send (flag on).
  sentAt?: string;
  sentTo?: string;
  sentToClient: boolean;
}

export interface Case {
  id: string;
  clientId: string;
  title: string;
  caseType: CaseType;
  status: CaseStatus;
  homeOfficeReference?: string;
  // Firm matter reference + recipient reference for letterheads.
  ourReference?: string;
  yourReference?: string;
  deadline?: string;
  createdAt: string;
  updatedAt: string;
  // Lawyer-authored case description.
  summary?: string;
  // AI-generated case summary (rolled up across sources by Haiku) +
  // when it was last regenerated. Distinct from `summary`.
  aiSummary?: string;
  aiSummaryGeneratedAt?: string;
  sources: Source[];
  generations: Generation[];
}

// Config for the "send letter" action on the Tools tab. Resolved on the
// server (feature flag + Outlook connection) and passed to the client.
// `enabled` is the SEND_TO_CLIENT_ENABLED flag — off means sends are
// locked to the lawyer's own `mailbox`; on means the lawyer may pick a
// recipient from `clientCandidates` (client email + grabbed email
// senders) or type their own.
export interface SendConfig {
  outlookConnected: boolean;
  // The lawyer's connected mailbox — offered as a recipient ("send to
  // myself") and used to flag a send as going to the client vs not.
  mailbox?: string;
  // Known client / correspondence addresses, offered in the recipient picker.
  clientCandidates: string[];
}

// --- Display helpers -------------------------------------------------------

export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  'spouse-visa': 'Spouse Visa',
  'family-visa': 'Family Visa',
  ilr: 'ILR',
  naturalisation: 'Naturalisation',
  'work-visa': 'Work Visa',
  'study-visa': 'Study Visa',
  'eu-settlement': 'EU Settlement',
  extension: 'Visa Extension',
  appeal: 'Appeal',
  asylum: 'Asylum',
  sponsorship: 'Sponsorship',
  other: 'Other',
};

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  submitted: 'Submitted',
  granted: 'Granted',
  refused: 'Refused',
  on_hold: 'On hold',
  closed: 'Closed',
};

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  file: 'File',
  note: 'Note',
  scan: 'Scan',
};

// --- Sidebar view-model ---------------------------------------------------

// The sidebar only needs id/title/status + the client's last name —
// pre-narrowing here means we don't push entire Case objects (with
// sources, generations, summaries) through the server→client boundary
// just to render a one-line list item.

export interface SidebarItem {
  caseId: string;
  caseTitle: string;
  caseStatus: CaseStatus;
  clientSurname: string;
  // Count of sources still being analysed (queue in flight) — drives the
  // "analysing" indicator on the sidebar row. 0 when nothing is pending.
  processing: number;
}

// Minimal client shape for the New-case modal's existing-client
// picker — just enough to render and reference by id.
export interface ClientOption {
  id: string;
  firstName: string;
  lastName: string;
}

// --- Facts (Pass-1 extraction) view-models --------------------------------

// One extracted fact, flattened for display. `sourceTitle` carries the
// provenance so the UI can show which document a fact came from.
export interface CaseFactView {
  id: string;
  type: FactType;
  label: string | null;
  value: string | null;
  factDate: string | null;
  confidence: string | null;
  sourceId: string;
  sourceTitle: string;
  // True when this row was merged across several sources — provenance is
  // then "N sources" and shouldn't link to a single document.
  merged?: boolean;
}

// Facts grouped by category for the Facts tab (e.g. "Key dates").
export interface CaseFactGroup {
  type: FactType;
  label: string;
  facts: CaseFactView[];
}

// One item of the consolidated, de-duplicated action plan for a case
// (an LLM merges the per-source action_item facts into this list).
export interface ActionPlanItem {
  text: string;
  priority?: string;
}

// A case task (the Action plan, now stateful). Seeded from action_item facts
// but persists its own status, so check-off survives a reanalyze. `kind` /
// `suggestedToolId` drive the action button (filled in Phase B). Dismissed
// tasks are excluded from the view.
export interface CaseTaskView {
  id: string;
  text: string;
  priority: 'high' | 'medium' | 'low';
  status: 'open' | 'done';
  kind: string;
  suggestedToolId: string | null;
  origin: 'ai' | 'manual';
}

// One row of the suggested evidence checklist for a case's route.
// `present` = the case's facts mention something matching the item;
// `matchedBy` is the fact value that satisfied it.
export interface EvidenceCheck {
  label: string;
  present: boolean;
  matchedBy?: string;
}
