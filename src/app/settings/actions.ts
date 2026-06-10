'use server';

import { revalidatePath } from 'next/cache';

// Re-render the settings page (and the /cases subtree, since the case
// headers show Outlook connect/pull state too) after a connection change.
// Used instead of router.refresh(), which doesn't re-render under
// experimental.staleTimes — same reasoning as revalidateCases().
export async function revalidateSettings(): Promise<void> {
  revalidatePath('/settings');
  revalidatePath('/cases', 'layout');
}
