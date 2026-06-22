import { AlertCircle } from 'lucide-react';
import UploadForm from '@/components/upload/UploadForm';
import { resolveUploadLink } from '@/lib/upload/links';

// PUBLIC page (no auth): a client opens this from the link their solicitor
// emailed and uploads documents to their case. We intentionally don't show
// any case details — anyone holding the link should not learn who/what the
// matter is; the client already knows.

export const dynamic = 'force-dynamic';

export default async function UploadPage({ params }: { params: { token: string } }) {
  const link = await resolveUploadLink(params.token);

  return (
    <div className="max-w-xl mx-auto p-6">
      {link ? (
        <UploadForm token={params.token} />
      ) : (
        <div className="card bg-base-100 border border-base-300 mt-8">
          <div className="card-body items-center text-center">
            <AlertCircle className="h-8 w-8 text-warning" />
            <h1 className="card-title text-base">Link expired or invalid</h1>
            <p className="text-sm text-base-content/70">
              This upload link is no longer valid. Please contact your solicitor for a new one.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
