'use client';

import { CheckCircle2, Eye, Mail, Pencil, Plus, Send, Sparkles } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { revalidateCases } from '@/app/cases/actions';
import type { Generation, SendConfig, Source } from '@/data/cases';

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
  // The latest generation for this tool on the case, if any — drives
  // the "View" button and the run-label. Its message thread is already
  // loaded (listGenerationsForCase), so viewing needs no extra fetch.
  latest?: Generation;
  // Ready sources on the case, offered as selectable context.
  sources: Array<Pick<Source, 'id' | 'title' | 'kind'>>;
  // Send configuration (feature flag + Outlook connection + recipient
  // candidates), resolved on the server.
  send: SendConfig;
}

// The only tool whose drafts can be emailed today (matches the API
// route's SENDABLE_TOOL_ID).
const SENDABLE_TOOL_ID = 'client-care-letter';

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
  latest,
  sources,
  send,
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

  // Open the send panel, seeding the subject and (flag-on) a default
  // recipient from the first candidate.
  function openSend() {
    setError(null);
    setSubject(`${toolLabel} — ${caseTitle}`);
    setRecipient(send.enabled ? (send.clientCandidates[0] ?? '') : '');
    setSendOpen(true);
  }

  async function handleSend() {
    if (!generationId) return;
    // Re-send guard — the draft already went out once.
    if (sent && !window.confirm('This letter was already sent. Send it again?')) return;
    setError(null);
    setIsSending(true);
    try {
      const res = await fetch(`/api/generations/${generationId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim() || undefined,
          // Recipient is only honoured server-side when the flag is on;
          // omit it otherwise so the server uses the mailbox floor.
          recipient: send.enabled ? recipient.trim() || undefined : undefined,
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

  const canSend = toolId === SENDABLE_TOOL_ID;
  const hasViewable = Boolean(latest && latest.messages.length > 1);
  // What the draft body shows: live stream text once it arrives, else
  // the committed draft (dimmed while we wait for the first token).
  const bodyText = isStreaming && streaming ? streaming : draft;
  const waiting = isStreaming && !streaming;

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
                  <p className={`whitespace-pre-wrap ${waiting ? 'opacity-40' : ''}`}>
                    {bodyText || <span className="loading loading-dots loading-sm" />}
                  </p>
                </div>
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

                  {!send.outlookConnected ? (
                    <p className="text-sm text-base-content/60">
                      Connect Outlook in Settings to send this letter.
                    </p>
                  ) : (
                    <>
                      <div>
                        <span className="label-text text-sm">Recipient</span>
                        {send.enabled ? (
                          <>
                            <input
                              type="email"
                              value={recipient}
                              onChange={(e) => setRecipient(e.target.value)}
                              list={`recipients-${generationId}`}
                              placeholder="client@example.com"
                              className="input input-bordered input-sm w-full mt-1"
                            />
                            {send.clientCandidates.length > 0 && (
                              <datalist id={`recipients-${generationId}`}>
                                {send.clientCandidates.map((c) => (
                                  <option key={c} value={c} />
                                ))}
                              </datalist>
                            )}
                          </>
                        ) : (
                          <p className="text-sm mt-1">
                            {send.mailbox}{' '}
                            <span className="text-base-content/50">
                              — sending to your own mailbox (client sending is disabled).
                            </span>
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
                          disabled={isSending || (send.enabled && !recipient.trim())}
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

              {/* Refine chat — rewrites the draft in place. */}
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
