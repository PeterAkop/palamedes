'use server';

import { revalidatePath } from 'next/cache';

// Re-render the triage list (and the /cases subtree + header count, since
// assigning creates a source on a case and changes the pending count)
// after a sync / assign / ignore. Server action because router.refresh()
// doesn't re-render under experimental.staleTimes.
export async function revalidateTriage(): Promise<void> {
  revalidatePath('/triage');
  revalidatePath('/cases', 'layout');
  revalidatePath('/', 'layout'); // header pending-count badge
}
