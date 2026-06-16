// Pure firm-details field shapes — no DB / server imports, so this is
// safe to import from a client component (the Settings form) without
// pulling the Drizzle/Neon code into the client bundle. The query layer
// (`queries.ts`) re-exports these for server callers.

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

// The editable text fields (everything except logo, which is an upload).
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
