import OutlookSettings from '@/components/settings/OutlookSettings';
import { getCurrentUserId } from '@/lib/auth';
import { getConnection } from '@/lib/outlook/tokens';

// Settings — owner-scoped. Today the only setting is the Outlook
// connection; this is also where future integrations (WhatsApp, etc.)
// and account settings will live. Behind the Basic Auth fence like
// everything else. Resilient to the integration_tokens table not
// existing yet so it never hard-crashes.

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const outlook = await getConnection(getCurrentUserId(), 'outlook').catch(() => ({
    connected: false as const,
    accountEmail: undefined,
  }));

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-1">Settings</h1>
      <p className="text-sm text-base-content/60 mb-6">Connections and account.</p>

      <div className="space-y-4">
        <OutlookSettings connected={outlook.connected} accountEmail={outlook.accountEmail} />
      </div>
    </div>
  );
}
