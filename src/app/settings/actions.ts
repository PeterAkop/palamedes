'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUserId } from '@/lib/auth';
import { FIRM_TEXT_FIELDS, type FirmTextField, saveFirmDetails } from '@/lib/firm/queries';

// Re-render the settings page (and the /cases subtree, since the case
// headers show Outlook connect/pull state too) after a connection change.
// Used instead of router.refresh(), which doesn't re-render under
// experimental.staleTimes — same reasoning as revalidateCases().
export async function revalidateSettings(): Promise<void> {
  revalidatePath('/settings');
  revalidatePath('/cases', 'layout');
}

// Save the firm details form (Settings → Firm details). Owner-scoped,
// upserted. Reads the known text fields off the FormData, ignores
// anything else, and re-renders the settings page on success.
export async function saveFirmDetailsAction(formData: FormData): Promise<void> {
  const ownerId = await getCurrentUserId();
  const values: Partial<Record<FirmTextField, string>> = {};
  for (const field of FIRM_TEXT_FIELDS) {
    const v = formData.get(field);
    if (typeof v === 'string') values[field] = v;
  }
  await saveFirmDetails(ownerId, values);
  revalidatePath('/settings');
}
