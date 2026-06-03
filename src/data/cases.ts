// Hardcoded data for the UX pass. Types here are the canonical shape
// we'll mirror in Drizzle when the DB lands — same field names, same
// optionality. When we swap to real persistence, only the data
// source changes; all the consumer components stay put.

export type CaseType =
  | 'spouse-visa'
  | 'family-visa'
  | 'ilr'
  | 'naturalisation'
  | 'work-visa'
  | 'study-visa'
  | 'eu-settlement'
  | 'extension'
  | 'appeal'
  | 'asylum'
  | 'sponsorship'
  | 'other';

export type CaseStatus =
  | 'open'
  | 'in_progress'
  | 'submitted'
  | 'granted'
  | 'refused'
  | 'on_hold'
  | 'closed';

export type SourceKind = 'whatsapp' | 'email' | 'file' | 'note' | 'scan';

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
  status: 'queued' | 'processing' | 'ready' | 'failed';
  aiSummary?: string;
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
  summary?: string;
  sources: Source[];
  generations: Generation[];
}

// --- Sample data -----------------------------------------------------------

export const clients: Client[] = [
  {
    id: 'cli-patel',
    firstName: 'Aarav',
    lastName: 'Patel',
    email: 'aarav.patel@example.com',
    phone: '+447700900111',
    dateOfBirth: '1989-05-12',
    nationality: 'Indian',
    preferredLanguage: 'English',
  },
  {
    id: 'cli-singh',
    firstName: 'Manpreet',
    lastName: 'Singh',
    email: 'm.singh@example.com',
    phone: '+447700900222',
    dateOfBirth: '1992-09-30',
    nationality: 'Indian',
    preferredLanguage: 'Punjabi',
  },
  {
    id: 'cli-khan',
    firstName: 'Sara',
    lastName: 'Khan',
    email: 'sara.khan@example.com',
    phone: '+447700900333',
    dateOfBirth: '1985-02-08',
    nationality: 'Pakistani',
    preferredLanguage: 'English',
  },
];

export const cases: Case[] = [
  {
    id: 'case-patel-ilr',
    clientId: 'cli-patel',
    title: 'ILR Application',
    caseType: 'ilr',
    status: 'in_progress',
    homeOfficeReference: 'IHS-2026-447821',
    deadline: '2026-08-15',
    createdAt: '2026-05-14T10:00:00Z',
    updatedAt: '2026-05-31T15:22:00Z',
    summary:
      'Indefinite Leave to Remain application following 5 years on Skilled Worker visa. Employer sponsorship confirmed, KOLL (Life in the UK) test passed Mar 2026. Awaiting confirmation of absences over the qualifying period.',
    sources: [
      {
        id: 'src-1',
        kind: 'email',
        title: 'KOLL test pass confirmation',
        contentPreview:
          'Dear Mr Patel, We confirm that you have successfully passed the Life in the UK test on…',
        sourceReceivedAt: '2026-03-14T11:32:00Z',
        metadata: { from: 'no-reply@lifeintheuktest.gov.uk', subject: 'Pass confirmation' },
        status: 'ready',
        aiSummary: 'KOLL test passed 14 March 2026. Confirmation reference 8821-A.',
      },
      {
        id: 'src-2',
        kind: 'file',
        title: 'P60-2025-26.pdf',
        sourceReceivedAt: '2026-04-08T14:00:00Z',
        metadata: { mime_type: 'application/pdf', size_bytes: '184000' },
        status: 'ready',
        aiSummary:
          'P60 for tax year 2025–26 showing gross income £58,400 from employer Acme Ltd. Sponsorship salary threshold met.',
      },
      {
        id: 'src-3',
        kind: 'whatsapp',
        title: 'Re: absences list',
        contentPreview:
          'Hi, here is my list of trips out of the UK over the last 5 years — total 78 days I think…',
        sourceReceivedAt: '2026-05-22T18:45:00Z',
        metadata: { from_phone: '+447700900111' },
        status: 'ready',
        aiSummary:
          "Client's self-reported total absences: 78 days over qualifying period. Below 180-day annual cap; needs verification against boarding passes / passport stamps.",
      },
      {
        id: 'src-4',
        kind: 'note',
        title: 'Verify absences against passport stamps',
        contentPreview:
          'Need to cross-check the WhatsApp list against actual entry/exit stamps before drafting the cover letter — flag if discrepancy > 5 days.',
        sourceReceivedAt: '2026-05-27T09:10:00Z',
        status: 'ready',
      },
      {
        id: 'src-5',
        kind: 'scan',
        title: 'Passport scan (biometric page).jpg',
        sourceReceivedAt: '2026-05-28T16:00:00Z',
        metadata: { mime_type: 'image/jpeg', size_bytes: '1240000' },
        status: 'processing',
      },
    ],
    generations: [
      {
        id: 'gen-1',
        toolId: 'cover-letter-ilr',
        version: 1,
        status: 'complete',
        model: 'claude-opus-4-8',
        createdAt: '2026-05-30T11:00:00Z',
        messages: [
          {
            role: 'assistant',
            content:
              'Dear Sir/Madam, I am writing on behalf of my client Mr Aarav Patel in support of his application for Indefinite Leave to Remain…',
          },
        ],
      },
    ],
  },
  {
    id: 'case-patel-citizenship',
    clientId: 'cli-patel',
    title: 'Naturalisation (post-ILR)',
    caseType: 'naturalisation',
    status: 'open',
    deadline: undefined,
    createdAt: '2026-05-31T16:00:00Z',
    updatedAt: '2026-05-31T16:00:00Z',
    summary: 'Pencilled in for 12 months after ILR is granted. No source material gathered yet.',
    sources: [],
    generations: [],
  },
  {
    id: 'case-singh-spouse',
    clientId: 'cli-singh',
    title: 'Spouse Visa Application',
    caseType: 'spouse-visa',
    status: 'in_progress',
    homeOfficeReference: 'GWF-2026-301188',
    deadline: '2026-07-30',
    createdAt: '2026-04-01T09:00:00Z',
    updatedAt: '2026-06-01T10:00:00Z',
    summary:
      'Spouse visa application for sponsor with British citizen partner. Financial requirement met via Category A salary. Awaiting English language certificate.',
    sources: [
      {
        id: 'src-s1',
        kind: 'email',
        title: 'Marriage certificate (scanned)',
        contentPreview: 'Hi, please find attached our marriage certificate as requested…',
        sourceReceivedAt: '2026-04-12T13:00:00Z',
        metadata: { from: 'm.singh@example.com', has_attachments: 'true' },
        status: 'ready',
        aiSummary:
          'Marriage certificate dated 03 February 2024, registered in Croydon. Both spouses named correctly.',
      },
      {
        id: 'src-s2',
        kind: 'file',
        title: 'Payslips-Mar-Apr-May-2026.pdf',
        sourceReceivedAt: '2026-05-20T10:00:00Z',
        metadata: { mime_type: 'application/pdf', size_bytes: '720000' },
        status: 'ready',
        aiSummary:
          'Six consecutive payslips covering Mar–May 2026 showing gross monthly £2,950 from employer NHS Trust. Annualised £35,400 — meets the £29,000 financial requirement.',
      },
    ],
    generations: [],
  },
  {
    id: 'case-khan-appeal',
    clientId: 'cli-khan',
    title: 'Appeal — Spouse Visa Refusal',
    caseType: 'appeal',
    status: 'submitted',
    homeOfficeReference: 'IA/12345/2025',
    deadline: '2026-06-20',
    createdAt: '2026-03-15T11:00:00Z',
    updatedAt: '2026-05-15T14:30:00Z',
    summary:
      'Appeal against refusal under Para EX.1 (insurmountable obstacles). Refusal cited insufficient evidence of cohabitation. Bundle filed; awaiting tribunal date.',
    sources: [
      {
        id: 'src-k1',
        kind: 'file',
        title: 'Refusal letter 2025-12-04.pdf',
        sourceReceivedAt: '2025-12-04T09:00:00Z',
        metadata: { mime_type: 'application/pdf', size_bytes: '320000' },
        status: 'ready',
        aiSummary:
          'Home Office refusal dated 4 Dec 2025, citing failure to demonstrate insurmountable obstacles to continuing family life outside the UK (Pakistan). Right of appeal preserved.',
      },
    ],
    generations: [
      {
        id: 'gen-k1',
        toolId: 'appeal-grounds',
        version: 1,
        status: 'complete',
        model: 'claude-opus-4-8',
        createdAt: '2026-04-10T15:00:00Z',
        messages: [
          {
            role: 'assistant',
            content:
              'GROUNDS OF APPEAL — In the First-tier Tribunal (Immigration and Asylum Chamber)…',
          },
        ],
      },
    ],
  },
];

export function getCase(id: string): Case | undefined {
  return cases.find((c) => c.id === id);
}

export function getClient(id: string): Client | undefined {
  return clients.find((c) => c.id === id);
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

// --- Sidebar data assembly ------------------------------------------------

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

export function buildSidebarItems(): SidebarItem[] {
  return cases.map((c) => {
    const cl = clients.find((x) => x.id === c.clientId);
    return {
      caseId: c.id,
      caseTitle: c.title,
      caseStatus: c.status,
      clientSurname: cl?.lastName ?? 'Unknown',
    };
  });
}
