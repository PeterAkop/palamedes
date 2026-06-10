import { Briefcase, Inbox, Scale, Settings } from 'lucide-react';
import Link from 'next/link';
import { countPendingTriage } from '@/lib/triage/queries';

export default async function Header() {
  // Pending triage count for the nav badge. Resilient to the
  // mailbox_messages table not existing yet (pre-migration).
  const pending = await countPendingTriage().catch(() => 0);

  return (
    <div className="navbar bg-base-100 shadow-sm border-b">
      <div className="navbar-start gap-1">
        <Link href="/" className="btn btn-ghost text-xl gap-2">
          <Scale className="h-6 w-6 text-primary" />
          <span className="font-bold">Palamedes</span>
        </Link>
        <Link href="/cases" className="btn btn-ghost btn-sm gap-1" title="Cases">
          <Briefcase className="h-4 w-4" />
          Cases
        </Link>
      </div>
      <div className="navbar-end gap-1">
        <Link href="/triage" className="btn btn-ghost btn-sm gap-1" title="Mailbox triage">
          <Inbox className="h-4 w-4" />
          Triage
          {pending > 0 && <span className="badge badge-primary badge-sm">{pending}</span>}
        </Link>
        <Link href="/settings" className="btn btn-ghost btn-sm gap-1" title="Settings">
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </div>
  );
}
