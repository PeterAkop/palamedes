// View-model types and display labels for the cases UI. Real data
// comes from the DB via `src/lib/cases/queries.ts`; sample data for
// dev seeding lives in `scripts/seed-dev.mjs`.
//
// CaseType / CaseStatus are sourced from the schema's const tuples so
// any new value lands in both the DB CHECK constraint and the TS union
// at the same time. SourceKind / GenerationStatus stay local — their
// tables don't exist yet; this file is the only declaration of those
// shapes until they do.

import type { CaseStatus, CaseType, SourceKind, SourceStatus } from '@/db/db';

export type { CaseStatus, CaseType, SourceKind, SourceStatus };

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
  createdAt: string;
  messages: GenerationMessage[];
}

export interface Case {
  id: string;
  clientId: string;
  title: string;
  caseType: CaseType;
  status: CaseStatus;
  homeOfficeReference?: string;
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
}
