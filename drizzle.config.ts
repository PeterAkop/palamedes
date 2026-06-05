import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Next.js convention: env in .env.local. drizzle-kit doesn't read it by
// default — load it explicitly so commands like `db:generate` /
// `db:migrate` pick up DATABASE_URL.
config({ path: '.env.local' });

// DATABASE_URL is only required for commands that hit the DB (migrate,
// studio). `generate` only diffs schema files; an empty URL is fine
// there and the DB-touching commands will fail loudly when run without
// it set.
//
// Prefer DATABASE_URL_UNPOOLED for drizzle-kit: migrations are DDL,
// which conflicts with PgBouncer transaction-mode pooling (the pooled
// URL points at PgBouncer; the unpooled URL goes direct). Fall back to
// DATABASE_URL if only the pooled one is set.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
