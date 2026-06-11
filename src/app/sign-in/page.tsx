import { Scale } from 'lucide-react';
import { signIn } from '@/auth';

// Public sign-in page (allowed through the middleware). One provider for
// now — "Sign in with Microsoft" (Entra). The form action is a server
// action that kicks off the OAuth flow and returns to /cases.

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-base-200 px-4">
      <div className="card bg-base-100 border border-base-300 w-full max-w-sm">
        <div className="card-body items-center text-center gap-4">
          <div className="flex items-center gap-2">
            <Scale className="h-7 w-7 text-primary" />
            <span className="text-2xl font-bold">Palamedes</span>
          </div>
          <p className="text-sm text-base-content/60">Sign in to your UK immigration casework.</p>
          <form
            action={async () => {
              'use server';
              await signIn('microsoft-entra-id', { redirectTo: '/cases' });
            }}
            className="w-full"
          >
            <button type="submit" className="btn btn-primary w-full gap-2">
              Sign in with Microsoft
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
