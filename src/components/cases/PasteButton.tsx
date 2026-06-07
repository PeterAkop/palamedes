'use client';

import { ClipboardPaste, Mail, MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

// "Paste email / WhatsApp" button + modal. POSTs to
// /api/sources/paste, which inserts the source row and runs Haiku
// synchronously, returning status='ready'. We `router.refresh()` on
// success so the parent server component re-fetches the case and the
// Sources tab re-renders with the new row.
//
// Mirrors AddNoteButton's native <dialog> pattern; the extra wrinkle
// is the kind picker (email | whatsapp) which toggles which metadata
// fields show (subject for email, from-phone for WhatsApp).

type PasteKind = 'email' | 'whatsapp';

interface Props {
  caseId: string;
}

export default function PasteButton({ caseId }: Props) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<PasteKind>('email');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [fromPhone, setFromPhone] = useState('');
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
    setKind('email');
    setTitle('');
    setBody('');
    setFrom('');
    setSubject('');
    setFromPhone('');
    setError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      const res = await fetch('/api/sources/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId,
          kind,
          title,
          body,
          // Only send the fields relevant to the chosen kind; empty
          // strings become undefined so the route's optional Zod
          // fields don't reject them.
          from: from || undefined,
          subject: kind === 'email' ? subject || undefined : undefined,
          fromPhone: kind === 'whatsapp' ? fromPhone || undefined : undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(data.message ?? data.error ?? 'Failed to add source');
      }
      closeDialog();
      resetForm();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add source');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <button type="button" onClick={openDialog} className="btn btn-sm btn-ghost gap-1">
        <ClipboardPaste className="h-4 w-4" />
        Paste email / WhatsApp
      </button>

      <dialog ref={dialogRef} className="modal">
        <div className="modal-box max-w-xl">
          <h3 className="font-bold text-lg">Paste email or WhatsApp</h3>
          <p className="text-sm text-base-content/60 mt-1">
            Paste in correspondence from this case. Claude will summarise it for you.
          </p>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            {/* Kind picker */}
            <div role="tablist" className="tabs tabs-boxed w-fit">
              <button
                type="button"
                role="tab"
                aria-selected={kind === 'email'}
                onClick={() => setKind('email')}
                disabled={isPending}
                className={`tab gap-1 ${kind === 'email' ? 'tab-active' : ''}`}
              >
                <Mail className="h-4 w-4" />
                Email
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={kind === 'whatsapp'}
                onClick={() => setKind('whatsapp')}
                disabled={isPending}
                className={`tab gap-1 ${kind === 'whatsapp' ? 'tab-active' : ''}`}
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </button>
            </div>

            <div>
              <label htmlFor="paste-title" className="label py-1">
                <span className="label-text">Title</span>
              </label>
              <input
                id="paste-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={isPending}
                maxLength={200}
                placeholder={
                  kind === 'email'
                    ? 'e.g. Home Office acknowledgement'
                    : 'e.g. WhatsApp from client, 5 Jun'
                }
                className="input input-bordered w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="paste-from" className="label py-1">
                  <span className="label-text">From</span>
                  <span className="label-text-alt text-base-content/40">optional</span>
                </label>
                <input
                  id="paste-from"
                  type="text"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  disabled={isPending}
                  maxLength={200}
                  placeholder={kind === 'email' ? 'sender@example.com' : 'Contact name'}
                  className="input input-bordered w-full"
                />
              </div>

              {kind === 'email' ? (
                <div>
                  <label htmlFor="paste-subject" className="label py-1">
                    <span className="label-text">Subject</span>
                    <span className="label-text-alt text-base-content/40">optional</span>
                  </label>
                  <input
                    id="paste-subject"
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    disabled={isPending}
                    maxLength={300}
                    placeholder="Email subject line"
                    className="input input-bordered w-full"
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor="paste-phone" className="label py-1">
                    <span className="label-text">From phone</span>
                    <span className="label-text-alt text-base-content/40">optional</span>
                  </label>
                  <input
                    id="paste-phone"
                    type="tel"
                    value={fromPhone}
                    onChange={(e) => setFromPhone(e.target.value)}
                    disabled={isPending}
                    maxLength={50}
                    placeholder="+44…"
                    className="input input-bordered w-full"
                  />
                </div>
              )}
            </div>

            <div>
              <label htmlFor="paste-body" className="label py-1">
                <span className="label-text">Content</span>
              </label>
              <textarea
                id="paste-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
                disabled={isPending}
                maxLength={50_000}
                rows={8}
                placeholder="Paste the email or WhatsApp thread here…"
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
