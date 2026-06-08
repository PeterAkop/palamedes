'use server';

import { revalidatePath } from 'next/cache';

// Revalidate the /cases subtree after a mutation. We use this instead of
// `router.refresh()` because the project enables `experimental.staleTimes`
// (next.config), which breaks `router.refresh()` on Next 14.2.x — it
// serves the cached RSC payload instead of refetching, so freshly-added
// sources / summaries / generations never appear without a hard reload.
//
// A Server Action that calls `revalidatePath` invalidates the cache and
// re-renders reliably on the client. 'layout' scope covers both the case
// detail page and the sidebar (rendered in cases/layout), so source /
// summary / tool mutations AND case create/delete all reflect at once.
export async function revalidateCases(): Promise<void> {
  revalidatePath('/cases', 'layout');
}
