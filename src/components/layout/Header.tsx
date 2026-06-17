import startCase from 'lodash/startCase';
import { Briefcase, LogOut, Scale, Settings } from 'lucide-react';
import Link from 'next/link';
import { auth, signOut } from '@/auth';

export default async function Header() {
  const session = await auth();

  return (
    <div className="navbar bg-base-100 shadow-xs border-b sticky top-0 z-50">
      <div className="navbar-start gap-1">
        <Link href="/" className="btn btn-ghost text-xl gap-2">
          <Scale className="h-6 w-6 text-primary" />
          <span className="font-bold">Palamedes</span>
        </Link>
        {session && (
          <Link href="/cases" className="btn btn-ghost btn-sm gap-1" title="Cases">
            <Briefcase className="h-4 w-4" />
            Cases
          </Link>
        )}
      </div>

      {session && (
        <div className="navbar-end gap-1">
          <Link href="/settings" className="btn btn-ghost btn-sm gap-1" title="Settings">
            <Settings className="h-4 w-4" />
            Settings
          </Link>
          <span className="text-sm text-base-content/60 px-2 hidden sm:inline">
            {session.user?.name ? startCase(session.user.name) : session.user?.email}
          </span>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/sign-in' });
            }}
          >
            <button type="submit" className="btn btn-ghost btn-sm gap-1" title="Sign out">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
