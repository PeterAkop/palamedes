'use client';

import { CheckCircle2, Eye, Mail, Pencil, Plus, Send, Sparkles } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { revalidateCases } from '@/app/cases/actions';
import type { Generation, SendConfig, Source } from '@/data/cases';
import { findPlaceholders } from '@/lib/markdown';
import DraftView from './DraftView';

// Per-tool runner modal. Generates an Opus draft (streamed), then lets
// the lawyer refine it by chat or edit it by hand. The draft is a
// SINGLE living document: a refine rewrites it in place (the model
// returns a full new version), so the view shows one current letter,
// not a growing thread. The conversation is still kept server-side
// (generation_messages) for refine context.
//
// On close it revalidates so the Tools list reflects the persisted
// generation. "View" re-opens the latest stored draft to read/continue.

interface Props {
  caseId: string;
  caseTitle: string;
  toolId: string;
  toolLabel: string;
  // Template tools (e.g. Request Documents) build their content directly —
  // editable by hand but not refinable by chat.
  template?: boolean;
  // The latest generation for this tool on the case, if any — drives
  // the "View" button and the run-label. Its message thread is already
  // loaded (listGenerationsForCase), so viewing needs no extra fetch.
  latest?: Generation;
  // Ready sources on the case, offered as selectable context.
  sources: Array<Pick<Source, 'id' | 'title' | 'kind'>>;
  // Send configuration (feature flag + Outlook connection + recipient
  // candidates), resolved on the server.
  send: SendConfig;
  // Auto-open the run dialog on mount — set when the Action plan deep-links
  // to this tool (?run=<toolId>). `onAutoOpened` clears that param so a
  // refresh doesn't reopen the dialog.
  autoOpen?: boolean;
  onAutoOpened?: () => void;
}

// Basic email-format check for the recipient picker.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

// Map the API's error codes to lawyer-facing messages. `detail` is the
// server's raw `message` (only set for send_failed) — surfaced so an
// unexpected Graph/token failure is diagnosable instead of a dead-end
// "Failed to send".
function sendErrorMessage(code?: string, detail?: string): string {
  switch (code) {
    case 'outlook_not_connected':
      return 'Connect Outlook (in Settings) before sending.';
    case 'insufficient_scope':
      return 'Reconnect Outlook to grant send permission, then try again.';
    case 'recipient_required':
      return 'Choose a recipient before sending.';
    case 'no_draft_to_send':
      return 'There is no draft to send yet.';
    default:
      return detail ? `Failed to send the letter: ${detail}` : 'Failed to send the letter.';
  }
}

// Short, readable timestamp for the "Sent on …" line.
function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ToolRunner({
  caseId,
  caseTitle,
  toolId,
  toolLabel,
  template,
  latest,
  sources,
  send,
  autoOpen,
  onAutoOpened,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [phase, setPhase] = useState<'config' | 'draft'>('config');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sources.map((s) => s.id)));
  const [instructions, setInstructions] = useState('');

  const [generationId, setGenerationId] = useState<string | null>(null);
  const [draft, setDraft] = useState(''); // committed current letter
  const [streaming, setStreaming] = useState(''); // live buffer while streaming
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamKind, setStreamKind] = useState<'generate' | 'refine'>('generate');

  const [chatInput, setChatInput] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');

  // Send panel. `sendOpen` toggles the recipient/subject form inside the
  // draft view. `sent` mirrors the generation's persisted send record so
  // the UI can show "Sent to X" without a refetch.
  const [sendOpen, setSendOpen] = useState(false);
  const [recipient, setRecipient] = useState('');
  // True when the lawyer picked "Other…" and is typing a custom address.
  const [isCustomRecipient, setIsCustomRecipient] = useState(false);
  const [subject, setSubject] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState<{ to: string; at: string; toClient: boolean } | null>(null);

  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setPhase('config');
    setSelected(new Set(sources.map((s) => s.id)));
    setInstructions('');
    setGenerationId(null);
    setDraft('');
    setStreaming('');
    setChatInput('');
    setIsEditing(false);
    setSendOpen(false);
    setSent(null);
    setError(null);
    dialogRef.current?.showModal();
  }

  // Deep-link auto-open: when the Action plan routes here (?run=<toolId>),
  // open the run dialog once and clear the param via onAutoOpened.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpen && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      openDialog();
      onAutoOpened?.();
    }
  });

  // Open the latest stored generation to read / continue. The current
  // draft is the last assistant message; generationId is set so refine
  // and edit target it.
  function openViewer() {
    if (!latest) return;
    const lastAssistant = [...latest.messages].reverse().find((m) => m.role === 'assistant');
    setPhase('draft');
    setGenerationId(latest.id);
    setDraft(lastAssistant?.content ?? '');
    setStreaming('');
    setChatInput('');
    setIsEditing(false);
    setSendOpen(false);
    setSent(
      latest.sentAt
        ? { to: latest.sentTo ?? '', at: latest.sentAt, toClient: latest.sentToClient }
        : null,
    );
    setError(null);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
    void revalidateCases();
  }

  function toggleSource(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Read an NDJSON stream, accumulating assistant text into `streaming`.
  // Returns the full text; throws on an error line / empty body.
  async function consumeStream(res: Response): Promise<string> {
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      throw new Error(data.message ?? data.error ?? 'Generation failed');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let streamError: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const evt = JSON.parse(line) as {
          type: string;
          text?: string;
          generationId?: string;
          message?: string;
        };
        if (evt.type === 'start' && evt.generationId) {
          setGenerationId(evt.generationId);
        } else if (evt.type === 'delta' && evt.text) {
          full += evt.text;
          setStreaming(full);
        } else if (evt.type === 'error') {
          streamError = evt.message ?? 'Generation failed';
        }
      }
    }
    if (streamError) throw new Error(streamError);
    return full;
  }

  async function handleGenerate() {
    setError(null);
    setStreamKind('generate');
    setIsStreaming(true);
    setPhase('draft');
    setStreaming('');
    setDraft('');
    try {
      const res = await fetch('/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId,
          toolId,
          sourceIds: Array.from(selected),
          instructions: instructions || undefined,
        }),
      });
      const full = await consumeStream(res);
      setDraft(full);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setStreaming('');
      setIsStreaming(false);
    }
  }

  async function handleRefine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!generationId || !chatInput.trim()) return;
    const instruction = chatInput.trim();
    setChatInput('');
    setError(null);
    setStreamKind('refine');
    setIsStreaming(true);
    setStreaming('');
    try {
      const res = await fetch(`/api/generations/${generationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: instruction }),
      });
      const full = await consumeStream(res);
      setDraft(full); // rewrite in place — the refined letter replaces the old one
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refinement failed');
    } finally {
      setStreaming('');
      setIsStreaming(false);
    }
  }

  function startEdit() {
    setEditText(draft);
    setIsEditing(true);
    setError(null);
  }

  async function saveEdit() {
    if (!generationId) return;
    setError(null);
    try {
      const res = await fetch(`/api/generations/${generationId}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editText }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Failed to save edit');
      }
      setDraft(editText);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save edit');
    }
  }

  // Open the send panel, seeding the subject and a default recipient
  // (the applicant if known, else the lawyer's own mailbox).
  function openSend() {
    setError(null);
    setSubject(`${toolLabel} — ${caseTitle}`);
    setRecipient(send.clientCandidates[0] ?? send.mailbox ?? '');
    setIsCustomRecipient(false);
    setSendOpen(true);
  }

  async function handleSend() {
    if (!generationId) return;
    // Re-send guard — the draft already went out once.
    if (sent && !window.confirm('This letter was already sent. Send it again?')) return;
    // Placeholder guard — warn before sending a draft with unfilled
    // [PLACEHOLDER] tokens still in it.
    if (outstandingPlaceholders.length > 0) {
      const n = outstandingPlaceholders.length;
      const ok = window.confirm(
        `This draft still has ${n} unfilled placeholder${n === 1 ? '' : 's'}:\n\n${outstandingPlaceholders.join('\n')}\n\nSend anyway?`,
      );
      if (!ok) return;
    }
    if (!isValidEmail(recipient)) {
      setError('Enter a valid recipient email address.');
      return;
    }
    setError(null);
    setIsSending(true);
    try {
      const res = await fetch(`/api/generations/${generationId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim() || undefined,
          recipient: recipient.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        sentAt?: string;
        sentTo?: string;
        sentToClient?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(sendErrorMessage(data.error, data.message));
      }
      setSent({
        to: data.sentTo ?? recipient,
        at: data.sentAt ?? new Date().toISOString(),
        toClient: Boolean(data.sentToClient),
      });
      setSendOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setIsSending(false);
    }
  }

  // Any tool's draft can be sent now; the recipient picker (with the
  // lawyer's own mailbox as an option) replaces the old send-to-client flag.
  const canSend = true;
  const hasViewable = Boolean(latest && latest.messages.length > 1);
  // What the draft body shows: live stream text once it arrives, else
  // the committed draft (dimmed while we wait for the first token).
  const bodyText = isStreaming && streaming ? streaming : draft;
  const waiting = isStreaming && !streaming;
  // Outstanding placeholders gate the send and drive the warning banner.
  const outstandingPlaceholders = useMemo(() => findPlaceholders(draft), [draft]);
  // Recipient options for the picker: known client addresses + the lawyer's
  // own mailbox, deduped.
  const knownRecipients = useMemo(
    () => [...new Set([...send.clientCandidates, ...(send.mailbox ? [send.mailbox] : [])])],
    [send.clientCandidates, send.mailbox],
  );

  // Apply an interactive draft edit (placeholder removed / date filled):
  // update locally and persist as a manual edit so it survives a refetch.
  async function applyContentChange(next: string) {
    setDraft(next);
    if (!generationId) return;
    await fetch(`/api/generations/${generationId}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: next }),
    }).catch(() => {});
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {hasViewable && (
          <button type="button" onClick={openViewer} className="btn btn-sm btn-ghost gap-1">
            <Eye className="h-3 w-3" />
            View
          </button>
        )}
        <button type="button" onClick={openDialog} className="btn btn-sm btn-primary gap-1">
          <Plus className="h-3 w-3" />
          {latest ? 'New run' : 'Generate'}
        </button>
      </div>

      <dialog ref={dialogRef} className="modal">
        <div className="modal-box max-w-3xl">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {toolLabel}
          </h3>

          {phase === 'config' ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-base-content/60">
                Opus drafts this document from the case summary and the sources you select. You can
                refine or edit it afterwards.
              </p>

              <div>
                <p className="text-sm font-medium mb-1">Sources to include</p>
                {sources.length === 0 ? (
                  <p className="text-sm text-base-content/50 italic">
                    No ready sources yet — the draft will use the case summary only.
                  </p>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1 rounded-md border border-base-300 p-2">
                    {sources.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected.has(s.id)}
                          onChange={() => toggleSource(s.id)}
                          className="checkbox checkbox-sm"
                        />
                        <span className="truncate">{s.title}</span>
                        <span className="text-xs text-base-content/40 ml-auto shrink-0">
                          {s.kind}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="tool-instructions" className="label py-1">
                  <span className="label-text">Instructions</span>
                  <span className="label-text-alt text-base-content/40">optional</span>
                </label>
                <textarea
                  id="tool-instructions"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={2}
                  placeholder="e.g. Emphasise the financial requirement is met via savings."
                  className="textarea textarea-bordered w-full"
                />
              </div>

              {error && (
                <div className="alert alert-error text-sm py-2">
                  <span>{error}</span>
                </div>
              )}

              <div className="modal-action">
                <button type="button" onClick={closeDialog} className="btn btn-ghost">
                  Cancel
                </button>
                <button type="button" onClick={handleGenerate} className="btn btn-primary">
                  Generate draft
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-base-content/40 flex items-center gap-2">
                  Draft
                  {isStreaming && (
                    <span className="flex items-center gap-1 text-primary normal-case tracking-normal">
                      <span className="loading loading-spinner loading-xs" />
                      {streamKind === 'refine' ? 'Refining the draft…' : 'Generating…'}
                    </span>
                  )}
                </p>
                {!isEditing && draft && !isStreaming && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={startEdit}
                      className="btn btn-ghost btn-xs gap-1"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                    {canSend && (
                      <button
                        type="button"
                        onClick={openSend}
                        className="btn btn-ghost btn-xs gap-1"
                      >
                        <Mail className="h-3 w-3" />
                        {sent ? 'Resend' : 'Send'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {isEditing ? (
                <>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={18}
                    className="textarea textarea-bordered w-full font-mono text-xs leading-relaxed"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="btn btn-ghost btn-sm"
                    >
                      Cancel
                    </button>
                    <button type="button" onClick={saveEdit} className="btn btn-primary btn-sm">
                      Save
                    </button>
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-base-300 p-4 max-h-[55vh] overflow-y-auto prose prose-sm max-w-none">
                  {isStreaming ? (
                    <p className={`whitespace-pre-wrap ${waiting ? 'opacity-40' : ''}`}>
                      {bodyText || <span className="loading loading-dots loading-sm" />}
                    </p>
                  ) : draft ? (
                    <DraftView
                      content={draft}
                      interactive={!isSending}
                      onChange={applyContentChange}
                    />
                  ) : (
                    <span className="loading loading-dots loading-sm" />
                  )}
                </div>
              )}

              {/* AI disclaimer — chrome only, never part of the draft body
                  (so it isn't included when the letter/email is sent). */}
              {!isEditing && draft && !isStreaming && (
                <p className="flex items-center gap-1.5 text-xs text-base-content/50 italic">
                  <Sparkles className="h-3 w-3 text-primary/60 shrink-0" />
                  AI-generated content — solicitor review required before use.
                </p>
              )}

              {/* Sent confirmation — mirrors the persisted send record. */}
              {sent && !sendOpen && (
                <div className="flex items-center gap-2 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>
                    Sent to {sent.to}
                    {!sent.toClient && ' (your mailbox)'} on {formatSentAt(sent.at)}
                  </span>
                </div>
              )}

              {/* Send panel — recipient + subject + body preview. Only
                  rendered for the sendable tool; toggled by openSend. */}
              {canSend && sendOpen && !isEditing && (
                <div className="rounded-md border border-base-300 p-3 space-y-3 bg-base-200/40">
                  <p className="text-xs uppercase tracking-wide text-base-content/40 flex items-center gap-2">
                    <Mail className="h-3 w-3" />
                    Send letter
                  </p>

                  {outstandingPlaceholders.length > 0 && (
                    <div className="alert alert-warning text-xs py-2">
                      <span>
                        {outstandingPlaceholders.length} unfilled placeholder
                        {outstandingPlaceholders.length === 1 ? '' : 's'} still in the draft (
                        {outstandingPlaceholders.join(', ')}). Edit the draft to complete them
                        before sending.
                      </span>
                    </div>
                  )}

                  {!send.outlookConnected ? (
                    <p className="text-sm text-base-content/60">
                      Connect Outlook in Settings to send this letter.
                    </p>
                  ) : (
                    <>
                      <div>
                        <span className="label-text text-sm">Recipient</span>
                        <select
                          value={isCustomRecipient ? '__other__' : recipient}
                          onChange={(e) => {
                            if (e.target.value === '__other__') {
                              setIsCustomRecipient(true);
                              setRecipient('');
                            } else {
                              setIsCustomRecipient(false);
                              setRecipient(e.target.value);
                            }
                          }}
                          className="select select-bordered select-sm w-full mt-1"
                        >
                          {knownRecipients.map((c) => (
                            <option key={c} value={c}>
                              {c}
                              {c === send.mailbox ? ' — my mailbox' : ''}
                            </option>
                          ))}
                          <option value="__other__">Other…</option>
                        </select>
                        {isCustomRecipient && (
                          <input
                            type="email"
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            placeholder="name@example.com"
                            className="input input-bordered input-sm w-full mt-2"
                          />
                        )}
                        {recipient.trim() !== '' && !isValidEmail(recipient) && (
                          <p className="text-xs text-error mt-1">Enter a valid email address.</p>
                        )}
                        {isValidEmail(recipient) &&
                          send.mailbox &&
                          recipient.trim().toLowerCase() === send.mailbox.toLowerCase() && (
                            <p className="text-xs text-base-content/50 mt-1">
                              Sending to your own mailbox — the client won't receive it.
                            </p>
                          )}
                      </div>

                      <div>
                        <span className="label-text text-sm">Subject</span>
                        <input
                          type="text"
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                          className="input input-bordered input-sm w-full mt-1"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSendOpen(false)}
                          disabled={isSending}
                          className="btn btn-ghost btn-sm"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSend}
                          disabled={isSending || !isValidEmail(recipient)}
                          className="btn btn-primary btn-sm gap-1"
                        >
                          {isSending ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            <Mail className="h-3.5 w-3.5" />
                          )}
                          {sent ? 'Resend' : 'Send'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {error && (
                <div className="alert alert-error text-sm py-2">
                  <span>{error}</span>
                </div>
              )}

              {/* Refine chat — rewrites the draft in place. Not for template
                  tools (they're built deterministically; edit by hand). */}
              {!template && (
                <form onSubmit={handleRefine} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={isStreaming || isEditing || !generationId}
                    placeholder="Describe a change — the draft will be rewritten…"
                    className="input input-bordered input-sm flex-1"
                  />
                  <button
                    type="submit"
                    disabled={isStreaming || isEditing || !generationId || !chatInput.trim()}
                    className="btn btn-sm btn-primary btn-square"
                    aria-label="Send refinement"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              )}

              <div className="modal-action">
                <button type="button" onClick={closeDialog} className="btn btn-ghost">
                  Done
                </button>
              </div>
            </div>
          )}
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
