'use client';

import { Hash, Pencil } from 'lucide-react';
import { useState } from 'react';
import { revalidateCases } from '@/app/cases/actions';

// Inline-editable matter references (our / your reference) on the case
// Overview. These feed the drafting tools; when blank the tools
// placeholder them rather than inventing a reference number. PATCHes
// /api/cases/[id] then revalidates so the new values flow into drafts.
export default function CaseReferences({
  caseId,
  ourReference,
  yourReference,
}: {
  caseId: string;
  ourReference?: string;
  yourReference?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [our, setOur] = useState(ourReference ?? '');
  const [your, setYour] = useState(yourReference ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ourReference: our, yourReference: your }),
      });
      if (!res.ok) throw new Error('Could not save references.');
      await revalidateCases();
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save references.');
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setOur(ourReference ?? '');
    setYour(yourReference ?? '');
    setError(null);
    setEditing(false);
  }

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <h2 className="card-title text-base gap-2">
            <Hash className="h-4 w-4 text-primary" />
            References
          </h2>
          {!editing && (
            <button
              type="button"
              className="btn btn-ghost btn-xs gap-1"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <label className="form-control">
              <span className="label-text text-xs text-base-content/60 pb-0.5">Our reference</span>
              <input
                className="input input-bordered input-sm w-full"
                value={our}
                onChange={(e) => setOur(e.target.value)}
                placeholder="e.g. MPB/2026/0042"
                disabled={saving}
              />
            </label>
            <label className="form-control">
              <span className="label-text text-xs text-base-content/60 pb-0.5">Your reference</span>
              <input
                className="input input-bordered input-sm w-full"
                value={your}
                onChange={(e) => setYour(e.target.value)}
                disabled={saving}
              />
            </label>
            {error && <p className="text-error text-xs">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={cancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={save}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <span className="loading loading-spinner loading-xs" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-base-content/60">Our reference</dt>
            <dd>{ourReference ?? <span className="text-base-content/40 italic">not set</span>}</dd>
            <dt className="text-base-content/60">Your reference</dt>
            <dd>{yourReference ?? <span className="text-base-content/40 italic">not set</span>}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}
