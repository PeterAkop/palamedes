import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// Drizzle client for Palamedes. Server-only — imported by server
// components, route handlers, server actions, and seed scripts. The
// Neon serverless driver speaks HTTP per query (no long-lived TCP
// connection), which suits Next.js serverless invocations: each
// request gets a fresh HTTP call without paying connection-setup cost
// against the database.
//
// We use the pooled DATABASE_URL here — pooled is fine for
// query-style traffic (HTTP queries don't share connections in a
// problematic way). drizzle-kit migrate uses DATABASE_URL_UNPOOLED
// instead (see drizzle.config.ts) because DDL is incompatible with
// PgBouncer's transaction-mode pooling.

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set — add the pooled Neon connection string to .env.local.');
}

const sql = neon(url);

export const db = drizzle(sql, { schema });
export type DB = typeof db;

// Re-export the schema so callers can `import { db, clients, cases }
// from '@/db/db'` and get everything from one place — avoids each
// query file importing both './db' and './schema' separately.
export * from './schema';
