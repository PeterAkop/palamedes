import { and, eq } from 'drizzle-orm';
import type { IntegrationProvider } from '@/db/db';
import { db, integrationTokens } from '@/db/db';
import { decryptToken, encryptToken } from './crypto';
import { refreshAccessToken } from './oauth';

// Owner-scoped storage + lifecycle for integration OAuth tokens.
// Tokens are encrypted at rest (crypto.ts); the DB only holds
// ciphertext. One row per (owner, provider) — upserted on connect.

interface SaveArgs {
  ownerId: string;
  provider: IntegrationProvider;
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
  scope?: string;
  accountEmail?: string;
}

export async function saveTokens(args: SaveArgs): Promise<void> {
  const expiresAt = new Date(Date.now() + args.expiresInSeconds * 1000);
  const accessToken = encryptToken(args.accessToken);
  const refreshToken = args.refreshToken ? encryptToken(args.refreshToken) : null;

  await db
    .insert(integrationTokens)
    .values({
      ownerId: args.ownerId,
      provider: args.provider,
      accessToken,
      refreshToken,
      expiresAt,
      scope: args.scope ?? null,
      accountEmail: args.accountEmail ?? null,
    })
    .onConflictDoUpdate({
      target: [integrationTokens.ownerId, integrationTokens.provider],
      set: {
        accessToken,
        refreshToken,
        expiresAt,
        scope: args.scope ?? null,
        // Keep the existing account_email if a refresh didn't supply one.
        ...(args.accountEmail ? { accountEmail: args.accountEmail } : {}),
        updatedAt: new Date(),
      },
    });
}

export interface Connection {
  connected: boolean;
  accountEmail?: string;
}

export async function getConnection(
  ownerId: string,
  provider: IntegrationProvider,
): Promise<Connection> {
  const [row] = await db
    .select({ accountEmail: integrationTokens.accountEmail })
    .from(integrationTokens)
    .where(and(eq(integrationTokens.ownerId, ownerId), eq(integrationTokens.provider, provider)))
    .limit(1);
  return row
    ? { connected: true, accountEmail: row.accountEmail ?? undefined }
    : { connected: false };
}

export async function deleteConnection(
  ownerId: string,
  provider: IntegrationProvider,
): Promise<void> {
  await db
    .delete(integrationTokens)
    .where(and(eq(integrationTokens.ownerId, ownerId), eq(integrationTokens.provider, provider)));
}

// Return a usable access token, refreshing (and re-persisting) if the
// stored one is within 60s of expiry. Throws `outlook_not_connected` if
// there's no row.
export async function getValidAccessToken(
  ownerId: string,
  provider: IntegrationProvider,
): Promise<string> {
  const [row] = await db
    .select()
    .from(integrationTokens)
    .where(and(eq(integrationTokens.ownerId, ownerId), eq(integrationTokens.provider, provider)))
    .limit(1);
  if (!row) throw new Error('outlook_not_connected');

  const stillValid = row.expiresAt && row.expiresAt.getTime() > Date.now() + 60_000;
  if (stillValid) return decryptToken(row.accessToken);

  // Expired (or no expiry recorded) — refresh if we can.
  if (!row.refreshToken) return decryptToken(row.accessToken);

  const currentRefresh = decryptToken(row.refreshToken);
  const refreshed = await refreshAccessToken(currentRefresh);
  await saveTokens({
    ownerId,
    provider,
    accessToken: refreshed.access_token,
    // MS may rotate the refresh token; fall back to the current one.
    refreshToken: refreshed.refresh_token ?? currentRefresh,
    expiresInSeconds: refreshed.expires_in,
    scope: refreshed.scope,
  });
  return refreshed.access_token;
}
