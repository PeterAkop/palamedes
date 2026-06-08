'use client';

import { Plus, Send, Sparkles } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { revalidateCases } from '@/app/cases/actions';
import type { Source } from '@/data/cases';

// Per-tool runner modal. Kicks off a generation (POST /api/generations),
// streams the Opus draft in as NDJSON, then lets the lawyer refine it
// via chat (POST /api/generations/[id]/messages, same stream shape).
// On close it router.refresh()es so the Tools tab reflects the persisted
// generation. Scoped to one in-session generation per open — viewing a
// past run read-only is a later addition.

interface ThreadMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  caseId: string;
  toolId: string;
  toolLabel: string;
  hasRun: boolean;
  // Ready sources on the case, offered as selectable context.
  sources: Array<Pick<Source, 'id' | 'title' | 'kind'>>;
}

export default function ToolRunner({ caseId, toolId, toolLabel, hasRun, sources }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [phase, setPhase] = useState<'config' | 'thread'>('config');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sources.map((s) => s.id)));
  const [instructions, setInstructions] = useState('');
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setPhase('config');
    setSelected(new Set(sources.map((s) => s.id)));
    setInstructions('');
    setGenerationId(null);
    setMessages([]);
    setStreaming('');
    setChatInput('');
    setError(null);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
    // Reflect the persisted generation in the Tools list.
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

  // Read an NDJSON stream, dispatching each line. Accumulates assistant
  // text into `streaming`; resolves to the full assistant text (or
  // throws on an error line / empty body).
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
    setIsStreaming(true);
    setPhase('thread');
    setStreaming('');
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
      setMessages([{ role: 'assistant', content: full }]);
      setStreaming('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsStreaming(false);
    }
  }

  async function handleRefine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!generationId || !chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    setError(null);
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setStreaming('');
    try {
      const res = await fetch(`/api/generations/${generationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userMsg }),
      });
      const full = await consumeStream(res);
      setMessages((prev) => [...prev, { role: 'assistant', content: full }]);
      setStreaming('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refinement failed');
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <>
      <button type="button" onClick={openDialog} className="btn btn-sm btn-primary gap-1">
        <Plus className="h-3 w-3" />
        {hasRun ? 'New run' : 'Generate'}
      </button>

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
                refine it by chat afterwards.
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
              {/* Thread: prior turns + the live streaming assistant text. */}
              <div className="max-h-[50vh] overflow-y-auto space-y-3 rounded-md border border-base-300 p-3">
                {messages.map((m, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only thread, never reordered or filtered
                  <div key={`${m.role}-${i}`} className={m.role === 'user' ? 'pl-6' : ''}>
                    <p className="text-xs uppercase tracking-wide text-base-content/40 mb-1">
                      {m.role === 'user' ? 'You' : 'Draft'}
                    </p>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
                  </div>
                ))}
                {isStreaming && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-base-content/40 mb-1">
                      Draft
                    </p>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {streaming || <span className="loading loading-dots loading-sm" />}
                    </p>
                  </div>
                )}
              </div>

              {error && (
                <div className="alert alert-error text-sm py-2">
                  <span>{error}</span>
                </div>
              )}

              {/* Refine chat — enabled once the first draft has a generationId. */}
              <form onSubmit={handleRefine} className="flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={isStreaming || !generationId}
                  placeholder="Refine the draft… e.g. make the tone warmer"
                  className="input input-bordered input-sm flex-1"
                />
                <button
                  type="submit"
                  disabled={isStreaming || !generationId || !chatInput.trim()}
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
