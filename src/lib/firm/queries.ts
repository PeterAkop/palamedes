import { eq } from 'drizzle-orm';
import { db, firmSettings } from '@/db/db';

// Owner-scoped firm details (letterhead / signatory / boilerplate) that
// prefill generated client-facing letters. One row per owner, upserted.

// View-model: all optional strings. The UI binds to this; the tool
// context builder reads it to fold real firm details into drafts.
export interface FirmDetails {
  firmName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  sraNumber?: string;
  vatNumber?: string;
  logoBlobPath?: string;
  signatoryName?: string;
  signatoryTitle?: string;
  signatoryEmail?: string;
  assistingFeeEarner?: string;
  referencePrefix?: string;
  complaintsFooter?: string;
  bankDetails?: string;
}

// The editable fields (everything except logo, which is an upload).
export const FIRM_TEXT_FIELDS = [
  'firmName',
  'address',
  'phone',
  'email',
  'website',
  'sraNumber',
  'vatNumber',
  'signatoryName',
  'signatoryTitle',
  'signatoryEmail',
  'assistingFeeEarner',
  'referencePrefix',
  'complaintsFooter',
  'bankDetails',
] as const;

export type FirmTextField = (typeof FIRM_TEXT_FIELDS)[number];

function toView(row: typeof firmSettings.$inferSelect | undefined): FirmDetails {
  if (!row) return {};
  return {
    firmName: row.firmName ?? undefined,
    address: row.address ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    website: row.website ?? undefined,
    sraNumber: row.sraNumber ?? undefined,
    vatNumber: row.vatNumber ?? undefined,
    logoBlobPath: row.logoBlobPath ?? undefined,
    signatoryName: row.signatoryName ?? undefined,
    signatoryTitle: row.signatoryTitle ?? undefined,
    signatoryEmail: row.signatoryEmail ?? undefined,
    assistingFeeEarner: row.assistingFeeEarner ?? undefined,
    referencePrefix: row.referencePrefix ?? undefined,
    complaintsFooter: row.complaintsFooter ?? undefined,
    bankDetails: row.bankDetails ?? undefined,
  };
}

export async function getFirmDetails(ownerId: string): Promise<FirmDetails> {
  const [row] = await db
    .select()
    .from(firmSettings)
    .where(eq(firmSettings.ownerId, ownerId))
    .limit(1);
  return toView(row);
}

// Upsert the text fields for this owner. Empty strings are stored as
// null so a cleared field reads back as absent.
export async function saveFirmDetails(
  ownerId: string,
  values: Partial<Record<FirmTextField, string>>,
): Promise<void> {
  const normalized: Record<string, string | null> = {};
  for (const key of FIRM_TEXT_FIELDS) {
    const v = values[key];
    normalized[key] = v && v.trim().length > 0 ? v.trim() : null;
  }

  await db
    .insert(firmSettings)
    .values({ ownerId, ...normalized })
    .onConflictDoUpdate({
      target: firmSettings.ownerId,
      set: { ...normalized, updatedAt: new Date() },
    });
}
