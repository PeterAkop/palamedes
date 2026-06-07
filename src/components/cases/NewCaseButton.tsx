'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';
import { CASE_TYPE_LABEL, type CaseType, type ClientOption } from '@/data/cases';

// "New case" button + modal. Creates a case against either an existing
// client or a brand-new one (POST /api/cases handles both). On success
// navigates to the new case. Mirrors the AddNoteButton <dialog>
// pattern. Imports only types + the label map from @/data/cases — no
// server-only modules — so it's safe in a client component.

// Sorted [value, label] pairs for the case-type <select>.
const CASE_TYPE_OPTIONS = (Object.entries(CASE_TYPE_LABEL) as [CaseType, string][]).sort((a, b) =>
  a[1].localeCompare(b[1]),
);

interface Props {
  clients: ClientOption[];
  // Compact trigger for the sidebar header (xs ghost button) vs a
  // standalone button elsewhere.
  variant?: 'sidebar' | 'default';
}

export default function NewCaseButton({ clients, variant = 'default' }: Props) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [mode, setMode] = useState<'existing' | 'new'>(clients.length > 0 ? 'existing' : 'new');
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [nationality, setNationality] = useState('');
  const [title, setTitle] = useState('');
  const [caseType, setCaseType] = useState<CaseType>('ilr');
  const [homeOfficeReference, setHomeOfficeReference] = useState('');
  const [deadline, setDeadline] = useState('');

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setError(null);
    dialogRef.current?.showModal();
  }
  function closeDialog() {
    dialogRef.current?.close();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      const payload =
        mode === 'existing'
          ? { clientId, title, caseType, homeOfficeReference, deadline }
          : {
              newClient: { firstName, lastName, email, phone, nationality },
              title,
              caseType,
              homeOfficeReference,
              deadline,
            };
      // Drop empty optional strings so Zod's optionals don't reject them.
      const body = JSON.parse(JSON.stringify(payload, (_k, v) => (v === '' ? undefined : v)));
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(data.message ?? data.error ?? 'Failed to create case');
      }
      const { caseId } = (await res.json()) as { caseId: string };
      closeDialog();
      router.push(`/cases/${caseId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create case');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      {variant === 'sidebar' ? (
        <button type="button" onClick={openDialog} className="btn btn-ghost btn-xs gap-1">
          <Plus className="h-3 w-3" />
          New
        </button>
      ) : (
        <button type="button" onClick={openDialog} className="btn btn-sm btn-primary gap-1">
          <Plus className="h-4 w-4" />
          New case
        </button>
      )}

      <dialog ref={dialogRef} className="modal">
        <div className="modal-box max-w-xl">
          <h3 className="font-bold text-lg">New case</h3>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            {/* Client: existing vs new */}
            <div role="tablist" className="tabs tabs-boxed w-fit">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'existing'}
                onClick={() => setMode('existing')}
                disabled={isPending || clients.length === 0}
                className={`tab ${mode === 'existing' ? 'tab-active' : ''}`}
              >
                Existing client
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'new'}
                onClick={() => setMode('new')}
                disabled={isPending}
                className={`tab ${mode === 'new' ? 'tab-active' : ''}`}
              >
                New client
              </button>
            </div>

            {mode === 'existing' ? (
              <div>
                <label htmlFor="case-client" className="label py-1">
                  <span className="label-text">Client</span>
                </label>
                <select
                  id="case-client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  required
                  disabled={isPending}
                  className="select select-bordered w-full"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.lastName}, {c.firstName}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="nc-first" className="label py-1">
                    <span className="label-text">First name</span>
                  </label>
                  <input
                    id="nc-first"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    disabled={isPending}
                    maxLength={100}
                    className="input input-bordered w-full"
                  />
                </div>
                <div>
                  <label htmlFor="nc-last" className="label py-1">
                    <span className="label-text">Last name</span>
                  </label>
                  <input
                    id="nc-last"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    disabled={isPending}
                    maxLength={100}
                    className="input input-bordered w-full"
                  />
                </div>
                <div>
                  <label htmlFor="nc-email" className="label py-1">
                    <span className="label-text">Email</span>
                    <span className="label-text-alt text-base-content/40">optional</span>
                  </label>
                  <input
                    id="nc-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isPending}
                    maxLength={200}
                    className="input input-bordered w-full"
                  />
                </div>
                <div>
                  <label htmlFor="nc-phone" className="label py-1">
                    <span className="label-text">Phone</span>
                    <span className="label-text-alt text-base-content/40">optional</span>
                  </label>
                  <input
                    id="nc-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={isPending}
                    maxLength={50}
                    className="input input-bordered w-full"
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="nc-nat" className="label py-1">
                    <span className="label-text">Nationality</span>
                    <span className="label-text-alt text-base-content/40">optional</span>
                  </label>
                  <input
                    id="nc-nat"
                    type="text"
                    value={nationality}
                    onChange={(e) => setNationality(e.target.value)}
                    disabled={isPending}
                    maxLength={100}
                    className="input input-bordered w-full"
                  />
                </div>
              </div>
            )}

            {/* Case fields */}
            <div>
              <label htmlFor="case-title" className="label py-1">
                <span className="label-text">Case title</span>
              </label>
              <input
                id="case-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={isPending}
                maxLength={200}
                placeholder="e.g. ILR Application"
                className="input input-bordered w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="case-type" className="label py-1">
                  <span className="label-text">Type</span>
                </label>
                <select
                  id="case-type"
                  value={caseType}
                  onChange={(e) => setCaseType(e.target.value as CaseType)}
                  disabled={isPending}
                  className="select select-bordered w-full"
                >
                  {CASE_TYPE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="case-deadline" className="label py-1">
                  <span className="label-text">Deadline</span>
                  <span className="label-text-alt text-base-content/40">optional</span>
                </label>
                <input
                  id="case-deadline"
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  disabled={isPending}
                  className="input input-bordered w-full"
                />
              </div>
            </div>

            <div>
              <label htmlFor="case-ref" className="label py-1">
                <span className="label-text">Home Office reference</span>
                <span className="label-text-alt text-base-content/40">optional</span>
              </label>
              <input
                id="case-ref"
                type="text"
                value={homeOfficeReference}
                onChange={(e) => setHomeOfficeReference(e.target.value)}
                disabled={isPending}
                maxLength={100}
                placeholder="e.g. IHS-2026-…"
                className="input input-bordered w-full"
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
                {isPending ? 'Creating…' : 'Create case'}
              </button>
            </div>
          </form>
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
