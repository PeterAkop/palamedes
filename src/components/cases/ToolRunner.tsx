'use client';

import { Eye, Pencil, Plus, Send, Sparkles } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { revalidateCases } from '@/app/cases/actions';
import type { Generation, Source } from '@/data/cases';

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
  toolId: string;
  toolLabel: string;
  // The latest generation for this tool on the case, if any — drives
  // the "View" button and the run-label. Its message thread is already
  // loaded (listGenerationsForCase), so viewing needs no extra fetch.
  latest?: Generation;
  // Ready sources on the case, offered as selectable context.
  sources: Array<Pick<Source, 'id' | 'title' | 'kind'>>;
}

export default function ToolRunner({ caseId, toolId, toolLabel, latest, sources }: Props) {
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
                  <button type="button" onClick={startEdit} className="btn btn-ghost btn-xs gap-1">
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>
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
                <div className="rounded-md border border-base-300 p-3 max-h-[55vh] overflow-y-auto">
                  <p
                    className={`text-sm whitespace-pre-wrap leading-relaxed ${waiting ? 'opacity-40' : ''}`}
                  >
                    {bodyText || <span className="loading loading-dots loading-sm" />}
                  </p>
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
