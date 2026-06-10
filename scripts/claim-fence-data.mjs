// One-time: reassign all `owner_id = 'fence-user'` data (from the
// pre-auth fence era) to a real user id, so your existing test cases /
// sources / Outlook connection / triage carry over to your signed-in
// account instead of being orphaned.
//
// Usage:
//   1. Run the app, sign in once (creates your `user` row).
//   2. Find your user id:  SELECT id, email FROM "user";
//   3. node scripts/claim-fence-data.mjs <your-user-id>
//
// Owner-scoped tables updated: clients, cases, sources, generations,
// integration_tokens, mailbox_messages. (generation_messages has no
// owner_id — it follows its generation.)

import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';

config({ path: '.env.local' });

const targetUserId = process.argv[2];
if (!targetUserId) {
  console.error('Usage: node scripts/claim-fence-data.mjs <user-id>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// Confirm the target user exists (avoid reassigning to a typo'd id).
const users = await sql`SELECT id, email FROM "user" WHERE id = ${targetUserId}`;
if (users.length === 0) {
  console.error(`No user with id ${targetUserId}. Sign in first, then check SELECT id,email FROM "user".`);
  process.exit(1);
}
console.log(`Reassigning 'fence-user' data to ${users[0].email ?? targetUserId} …`);

const tables = ['clients', 'cases', 'sources', 'generations', 'integration_tokens', 'mailbox_messages'];
for (const table of tables) {
  const res = await sql.query(
    `UPDATE "${table}" SET owner_id = $1 WHERE owner_id = 'fence-user'`,
    [targetUserId],
  );
  console.log(`  ${table}: ${res.rowCount ?? 0} rows`);
}

console.log('Done.');
