import { Briefcase, Plus } from 'lucide-react';
import Link from 'next/link';

// Placeholder landing — gets replaced by the "Add first case" form in
// the cases-pages branch. The home page is intentionally task-focused
// from day one (no marketing chrome). Until /cases/new lands, the CTA
// links to /cases (which itself will show the case list / empty state).
export default function Home() {
  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-2xl mx-auto card bg-base-100 border border-base-300">
        <div className="card-body items-center text-center">
          <div className="p-3 bg-base-200 rounded-full mb-2">
            <Briefcase className="h-8 w-8 text-primary" />
          </div>
          <h1 className="card-title text-2xl">Palamedes</h1>
          <p className="text-base-content/70 max-w-md">
            UK immigration casework — intake from email, WhatsApp, files and notes; AI summaries per
            case; document generation for cover letters, client care letters, and appeals.
          </p>
          <div className="card-actions mt-4">
            <Link href="/cases" className="btn btn-primary gap-2">
              <Plus className="h-4 w-4" />
              Add your first case
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
