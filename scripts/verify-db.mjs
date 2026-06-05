// One-shot post-migration sanity check. Lists tables in the public
// schema and prints the columns of each — confirms the migration
// landed on the right database.
//
// Run: `node scripts/verify-db.mjs`. Not wired into package.json
// scripts; this is throwaway.

import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const tables = await sql`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
  ORDER BY table_name
`;

console.log('Tables in public:');
for (const t of tables) console.log(`  - ${t.table_name}`);

for (const t of tables) {
  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${t.table_name}
    ORDER BY ordinal_position
  `;
  console.log(`\n${t.table_name}:`);
  for (const c of cols) {
    console.log(
      `  ${c.column_name.padEnd(28)} ${c.data_type.padEnd(28)} ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`,
    );
  }
}
