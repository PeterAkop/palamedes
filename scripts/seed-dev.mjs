// Dev seed — wipes `cases` + `clients` and reinserts the three sample
// clients and four cases from the original hardcoded view-model. This
// is the single source of truth for dev sample data; nothing in
// `src/` should hold sample clients/cases any more.
//
// Run: `node scripts/seed-dev.mjs`
//
// Idempotent in the sense of "running it twice leaves the same end
// state" — it TRUNCATEs first. There is no UI for creating cases
// yet, so wiping is safe; once there is, gate this on NODE_ENV or
// remove it. Sources / generations are intentionally omitted — those
// tables don't exist yet (they land in their own phase) and their
// sample data lived in the old view-model.

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
// to the real UUID after the clients insert returns.
const CASES = [
  {
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
    clientKey: 'patel',
    title: 'Naturalisation (post-ILR)',
    caseType: 'naturalisation',
    status: 'open',
    homeOfficeReference: null,
    deadline: null,
    summary: 'Pencilled in for 12 months after ILR is granted. No source material gathered yet.',
  },
  {
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

// --- Seed -----------------------------------------------------------------

console.log('Wiping clients + cases (cascade) …');
// One TRUNCATE statement clears both tables atomically; CASCADE handles
// the FK from cases.client_id. RESTART IDENTITY is moot for UUIDs but
// kept for habit.
await sql`TRUNCATE TABLE clients, cases RESTART IDENTITY CASCADE`;

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
  console.log(`  + ${c.title} (${c.clientKey}) → ${row.id}`);
}

console.log('\nSeed complete.');
