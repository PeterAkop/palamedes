// Dev seed — wipes `clients`, `cases`, `sources` and reinserts the
// canonical sample data. This is the single source of truth for dev
// sample data; nothing in `src/` should hold sample clients/cases/
// sources any more.
//
// Run: `node scripts/seed-dev.mjs`
//
// Idempotent in the sense of "running it twice leaves the same end
// state" — it TRUNCATEs first. There is no UI for editing cases yet
// (notes can be added via the UI, but they get wiped on re-seed too),
// so wiping is safe; once that changes, gate this on NODE_ENV or
// scope the wipe to a specific owner.
//
// Source `ai_summary_model` is set to the literal string `'seed'`
// for seeded notes so they're greppable and distinguishable from
// summaries the real Haiku call generated. Production seeds (when
// we have them) would call the live API instead.

import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// Owner of every seeded row — matches the fence constant from
// src/lib/auth.ts. When real auth lands, this gets replaced (and the
// seed probably moves to per-user fixtures).
const OWNER_ID = 'fence-user';

// --- Sample data ----------------------------------------------------------

const CLIENTS = [
  {
    key: 'patel',
    firstName: 'Aarav',
    lastName: 'Patel',
    email: 'aarav.patel@example.com',
    phone: '+447700900111',
    dateOfBirth: '1989-05-12',
    nationality: 'Indian',
    preferredLanguage: 'English',
  },
  {
    key: 'singh',
    firstName: 'Manpreet',
    lastName: 'Singh',
    email: 'm.singh@example.com',
    phone: '+447700900222',
    dateOfBirth: '1992-09-30',
    nationality: 'Indian',
    preferredLanguage: 'Punjabi',
  },
  {
    key: 'khan',
    firstName: 'Sara',
    lastName: 'Khan',
    email: 'sara.khan@example.com',
    phone: '+447700900333',
    dateOfBirth: '1985-02-08',
    nationality: 'Pakistani',
    preferredLanguage: 'English',
  },
];

// `clientKey` references the `key` field above — the seed resolves it
// to the real UUID after the clients insert returns. `key` lets the
// NOTES array reference each case in the same way.
const CASES = [
  {
    key: 'patel-ilr',
    clientKey: 'patel',
    title: 'ILR Application',
    caseType: 'ilr',
    status: 'in_progress',
    homeOfficeReference: 'IHS-2026-447821',
    deadline: '2026-08-15',
    summary:
      'Indefinite Leave to Remain application following 5 years on Skilled Worker visa. Employer sponsorship confirmed, KOLL (Life in the UK) test passed Mar 2026. Awaiting confirmation of absences over the qualifying period.',
  },
  {
    key: 'patel-naturalisation',
    clientKey: 'patel',
    title: 'Naturalisation (post-ILR)',
    caseType: 'naturalisation',
    status: 'open',
    homeOfficeReference: null,
    deadline: null,
    summary: 'Pencilled in for 12 months after ILR is granted. No source material gathered yet.',
  },
  {
    key: 'singh-spouse',
    clientKey: 'singh',
    title: 'Spouse Visa Application',
    caseType: 'spouse-visa',
    status: 'in_progress',
    homeOfficeReference: 'GWF-2026-301188',
    deadline: '2026-07-30',
    summary:
      'Spouse visa application for sponsor with British citizen partner. Financial requirement met via Category A salary. Awaiting English language certificate.',
  },
  {
    key: 'khan-appeal',
    clientKey: 'khan',
    title: 'Appeal — Spouse Visa Refusal',
    caseType: 'appeal',
    status: 'submitted',
    homeOfficeReference: 'IA/12345/2025',
    deadline: '2026-06-20',
    summary:
      'Appeal against refusal under Para EX.1 (insurmountable obstacles). Refusal cited insufficient evidence of cohabitation. Bundle filed; awaiting tribunal date.',
  },
];

// Sample notes — pre-computed `ai_summary` matches what Haiku would
// produce for these inputs (1–3 sentences, factual, ≤80 words). When
// the seed reruns, this gives the UI immediately-rich Sources tabs
// without burning real Haiku tokens.
const NOTES = [
  {
    caseKey: 'patel-ilr',
    title: 'Phone call with client, 03 Jun 2026',
    body: "Spoke with Aarav on the phone about his ILR application. He confirmed his employer will provide a fresh sponsorship letter by Friday. He's worried about a 3-week trip to India in 2024 — wanted to know if it counts against the 180-day cap. Said he'll dig out the boarding passes tonight.",
    aiSummary:
      'Phone call 03 Jun: client to source fresh employer sponsorship letter by Friday and locate boarding passes for a 3-week 2024 India trip. Open question: whether the trip threatens the 180-day annual absence cap.',
  },
  {
    caseKey: 'patel-ilr',
    title: 'KOLL test pass',
    body: 'Confirmed Aarav passed the Life in the UK test on 14 March 2026. Reference 8821-A. Original certificate scanned and on file.',
    aiSummary:
      'Life in the UK test passed 14 March 2026, reference 8821-A. Original certificate scanned and on file.',
  },
  {
    caseKey: 'patel-ilr',
    title: 'Verify absences against passport stamps',
    body: 'Need to cross-check the WhatsApp list of trips against actual entry/exit stamps before drafting the cover letter — flag if discrepancy > 5 days. Client says total is 78 days but I want to verify.',
    aiSummary:
      "Action: cross-check the client's self-reported 78 days of absences against passport entry/exit stamps; flag any discrepancy over 5 days before drafting the cover letter.",
  },
  {
    caseKey: 'singh-spouse',
    title: 'Financial requirement review',
    body: "Manpreet's payslips Mar–May 2026 show £2,950/month from NHS Trust. Annualised £35,400 — comfortably above the £29,000 financial requirement under Category A. Recommend going with Category A on the application.",
    aiSummary:
      'Payslips Mar–May 2026 show £2,950/month from NHS Trust, annualised £35,400. Comfortably above the £29,000 Category A threshold. Recommend Category A on the application.',
  },
  {
    caseKey: 'singh-spouse',
    title: 'Awaiting English language certificate',
    body: 'Spouse needs to send over the IELTS Life Skills A1 certificate. Booked the test for 20 June; will follow up after the date.',
    aiSummary:
      'Action: collect IELTS Life Skills A1 certificate after the test on 20 June. Currently outstanding.',
  },
  {
    caseKey: 'khan-appeal',
    title: 'Refusal letter received 04 Dec 2025',
    body: 'Home Office refused under Para EX.1 — insufficient evidence of insurmountable obstacles to family life in Pakistan. We have right of appeal. Filing deadline: 14 days from receipt = 18 Dec 2025. Already submitted appeal notice on 12 Dec.',
    aiSummary:
      'Home Office refusal received 04 Dec 2025 under Para EX.1 (insurmountable obstacles). Appeal notice filed 12 Dec, within the 14-day window from receipt.',
  },
  {
    caseKey: 'khan-appeal',
    title: 'Bundle review notes',
    body: 'Bundle filed end of April. Awaiting tribunal hearing date. Sara to chase the CCD again on 10 Jun if no listing notice received by then.',
    aiSummary:
      'Appeal bundle filed end of April; awaiting hearing date. Action: client to chase Court Case Database on 10 June if no listing notice arrives by then.',
  },
];

// Sample pasted correspondence — email + WhatsApp sources. These
// exercise the slice-3 paste path: `kind` of 'email'/'whatsapp',
// `metadata` carrying from/subject/from_phone, and a
// `source_received_at` distinct from created_at. `ai_summary` is
// again pre-computed (`ai_summary_model='seed'`).
const MESSAGES = [
  {
    caseKey: 'patel-ilr',
    kind: 'email',
    title: 'Re: Sponsorship letter for ILR',
    receivedAt: '2026-06-05T09:14:00Z',
    metadata: { from: 'hr@brightwave-tech.co.uk', subject: 'Re: Sponsorship letter for ILR' },
    body: "Hi Aarav, please find attached the updated sponsorship letter confirming your continuous employment since March 2021 on the Skilled Worker route. Salary is unchanged at £52,000. Let us know if your solicitor needs anything further. Kind regards, HR — Brightwave Tech.",
    aiSummary:
      'Email 05 Jun from Brightwave Tech HR enclosing an updated sponsorship letter confirming continuous Skilled Worker employment since March 2021 at £52,000. Offers further assistance if needed.',
  },
  {
    caseKey: 'patel-ilr',
    kind: 'whatsapp',
    title: 'WhatsApp from client re: boarding passes',
    receivedAt: '2026-06-03T20:41:00Z',
    metadata: { from: 'Aarav Patel', from_phone: '+447700900111' },
    body: "Found the boarding passes for the India trip — left London 02 Aug 2024, came back 21 Aug 2024. So that's 19 days. I counted all my trips and it's 78 days total over the 5 years. Photos coming next.",
    aiSummary:
      'WhatsApp 03 Jun: client confirms 2024 India trip ran 02–21 Aug (19 days) and reports 78 days total absences across the 5-year period. Boarding-pass photos to follow.',
  },
  {
    caseKey: 'singh-spouse',
    kind: 'email',
    title: 'IELTS result notification',
    receivedAt: '2026-06-06T16:02:00Z',
    metadata: { from: 'no-reply@ielts.org', subject: 'Your IELTS Life Skills result' },
    body: "Dear candidate, your IELTS Life Skills A1 test taken on 20 June 2026 has been marked. Result: Pass. Your Test Report Form will be available to download within 5 working days.",
    aiSummary:
      'Email 06 Jun from IELTS confirming the spouse passed IELTS Life Skills A1 (test dated 20 June 2026). Test Report Form available within 5 working days — collect for the application.',
  },
];

// --- Seed -----------------------------------------------------------------

console.log('Wiping clients + cases + sources (cascade) …');
// TRUNCATE with CASCADE handles the FK from cases.client_id and
// sources.case_id; listing all three explicitly is cosmetic.
await sql`TRUNCATE TABLE clients, cases, sources RESTART IDENTITY CASCADE`;

console.log(`Inserting ${CLIENTS.length} clients …`);
const clientIdByKey = new Map();
for (const c of CLIENTS) {
  const [row] = await sql`
    INSERT INTO clients (
      owner_id, first_name, last_name, email, phone,
      date_of_birth, nationality, preferred_language
    ) VALUES (
      ${OWNER_ID}, ${c.firstName}, ${c.lastName}, ${c.email}, ${c.phone},
      ${c.dateOfBirth}, ${c.nationality}, ${c.preferredLanguage}
    )
    RETURNING id
  `;
  clientIdByKey.set(c.key, row.id);
  console.log(`  + ${c.firstName} ${c.lastName} → ${row.id}`);
}

console.log(`Inserting ${CASES.length} cases …`);
const caseIdByKey = new Map();
for (const c of CASES) {
  const clientId = clientIdByKey.get(c.clientKey);
  if (!clientId) throw new Error(`Unknown clientKey: ${c.clientKey}`);
  const [row] = await sql`
    INSERT INTO cases (
      client_id, owner_id, title, case_type, status,
      home_office_reference, deadline, summary
    ) VALUES (
      ${clientId}, ${OWNER_ID}, ${c.title}, ${c.caseType}, ${c.status},
      ${c.homeOfficeReference}, ${c.deadline}, ${c.summary}
    )
    RETURNING id
  `;
  caseIdByKey.set(c.key, row.id);
  console.log(`  + ${c.title} (${c.clientKey}) → ${row.id}`);
}

console.log(`Inserting ${NOTES.length} notes …`);
for (const n of NOTES) {
  const caseId = caseIdByKey.get(n.caseKey);
  if (!caseId) throw new Error(`Unknown caseKey: ${n.caseKey}`);
  await sql`
    INSERT INTO sources (
      case_id, owner_id, kind, title, content_preview,
      status, ai_summary, ai_summary_model
    ) VALUES (
      ${caseId}, ${OWNER_ID}, 'note', ${n.title}, ${n.body.slice(0, 300)},
      'ready', ${n.aiSummary}, 'seed'
    )
  `;
  console.log(`  + ${n.title} (${n.caseKey})`);
}

console.log(`Inserting ${MESSAGES.length} pasted messages …`);
for (const m of MESSAGES) {
  const caseId = caseIdByKey.get(m.caseKey);
  if (!caseId) throw new Error(`Unknown caseKey: ${m.caseKey}`);
  await sql`
    INSERT INTO sources (
      case_id, owner_id, kind, title, content_preview,
      source_received_at, metadata, status, ai_summary, ai_summary_model
    ) VALUES (
      ${caseId}, ${OWNER_ID}, ${m.kind}, ${m.title}, ${m.body.slice(0, 300)},
      ${m.receivedAt}, ${JSON.stringify(m.metadata)}, 'ready', ${m.aiSummary}, 'seed'
    )
  `;
  console.log(`  + [${m.kind}] ${m.title} (${m.caseKey})`);
}

console.log('\nSeed complete.');
