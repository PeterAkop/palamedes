import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { deleteConnection } from '@/lib/outlook/tokens';

// POST /api/integrations/outlook/disconnect — remove the stored Outlook
// tokens for the current owner. Owner-scoped (multi-user-safe: only the
// caller's connection is deleted). Revalidates so the settings page and
// case headers drop the connected state.

export const runtime = 'nodejs';

export async function POST() {
  await deleteConnection(getCurrentUserId(), 'outlook');
  revalidatePath('/cases', 'layout');
  revalidatePath('/settings');
  return NextResponse.json({ disconnected: true });
}
