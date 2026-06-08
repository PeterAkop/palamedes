'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

// Delete-case button + confirm modal. Deleting a case cascades to its
// sources and generated documents, so this gates behind an explicit
// confirmation that names the case. On success it navigates back to
// the cases index and refreshes so the sidebar drops the deleted case.

interface Props {
  caseId: string;
  caseTitle: string;
}

export default function DeleteCaseButton({ caseId, caseTitle }: Props) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setError(null);
    dialogRef.current?.showModal();
  }

  async function handleDelete() {
    setError(null);
    setIsPending(true);
    try {
      const res = await fetch(`/api/cases/${caseId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Failed to delete case');
      }
      dialogRef.current?.close();
      router.push('/cases');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete case');
      setIsPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="btn btn-sm btn-ghost gap-1 text-error/80 hover:text-error"
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </button>

      <dialog ref={dialogRef} className="modal">
        <div className="modal-box">
          <h3 className="font-bold text-lg">Delete case</h3>
          <p className="text-sm text-base-content/70 mt-2">
            Delete <span className="font-medium">{caseTitle}</span>? This permanently removes the
            case and <span className="font-medium">all of its sources and generated documents</span>
            . The client record is kept. This cannot be undone.
          </p>

          {error && (
            <div className="alert alert-error text-sm py-2 mt-3">
              <span>{error}</span>
            </div>
          )}

          <div className="modal-action">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              disabled={isPending}
              className="btn btn-ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="btn btn-error"
            >
              {isPending && <span className="loading loading-spinner loading-xs" />}
              {isPending ? 'Deleting…' : 'Delete case'}
            </button>
          </div>
        </div>

        <form method="dialog" className="modal-backdrop">
          <button type="submit" aria-label="Close">
            close
          </button>
        </form>
      </dialog>
    </>
  );
}
