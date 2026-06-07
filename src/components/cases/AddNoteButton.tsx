'use client';

import { NotebookPen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

// "Add note" button + modal. POSTs to /api/sources/notes, the route
// inserts the source row and runs Haiku synchronously, returns with
// status='ready'. We `router.refresh()` after success so the parent
// server component re-fetches the case (sources query picks up the
// new row, the Sources tab re-renders with it).
//
// Modal uses native <dialog>'s showModal()/close() — daisyUI styles
// it; no portal, no library. The trailing form[method="dialog"]
// gives click-outside-to-close for free.

interface Props {
  caseId: string;
}

export default function AddNoteButton({ caseId }: Props) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setError(null);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  function resetForm() {
    setTitle('');
    setBody('');
    setError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      const res = await fetch('/api/sources/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, title, body }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(data.message ?? data.error ?? 'Failed to add note');
      }
      closeDialog();
      resetForm();
      // Server component re-fetches; new source row appears in the
      // Sources list with whatever status Haiku produced.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add note');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="btn btn-sm btn-ghost gap-1"
      >
        <NotebookPen className="h-4 w-4" />
        Add note
      </button>

      <dialog ref={dialogRef} className="modal">
        <div className="modal-box max-w-xl">
          <h3 className="font-bold text-lg">Add note</h3>
          <p className="text-sm text-base-content/60 mt-1">
            Paste a piece of information about this case. Claude will summarise it for you.
          </p>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <div>
              <label htmlFor="note-title" className="label py-1">
                <span className="label-text">Title</span>
              </label>
              <input
                id="note-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={isPending}
                maxLength={200}
                placeholder="e.g. Phone call with client, 5 Jun"
                className="input input-bordered w-full"
              />
            </div>

            <div>
              <label htmlFor="note-body" className="label py-1">
                <span className="label-text">Content</span>
              </label>
              <textarea
                id="note-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
                disabled={isPending}
                maxLength={20_000}
                rows={8}
                placeholder="Paste or type the note content here…"
                className="textarea textarea-bordered w-full"
              />
            </div>

            {error && (
              <div className="alert alert-error text-sm py-2">
                <span>{error}</span>
              </div>
            )}

            <div className="modal-action">
              <button
                type="button"
                onClick={closeDialog}
                disabled={isPending}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button type="submit" disabled={isPending} className="btn btn-primary">
                {isPending && <span className="loading loading-spinner loading-xs" />}
                {isPending ? 'Saving…' : 'Save & summarise'}
              </button>
            </div>
          </form>
        </div>

        {/* Click-outside-to-close via the dialog's native backdrop. */}
        <form method="dialog" className="modal-backdrop">
          <button type="submit" aria-label="Close">
            close
          </button>
        </form>
      </dialog>
    </>
  );
}
