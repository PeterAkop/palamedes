'use client';

import { CalendarDays, X } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

// Interactive renderer for a generated draft. Renders the small markdown
// subset the tools produce (whole-line bold as headings, inline bold,
// lists, hr, line breaks) and turns [PLACEHOLDER] tokens into highlighted
// chips. Header/footer field placeholders (a line that is just
// "LABEL: [PLACEHOLDER]") get a remove (×) button; [DATE] gets a button to
// fill today's date; placeholders embedded in prose are highlighted only.

const PLACEHOLDER_RE = /\[[A-Z][A-Z0-9 ./_-]*\]/g;

function todayUK(): string {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// A line whose entire content is "Label: [PLACEHOLDER]" (the reference /
// date header fields), as opposed to a placeholder embedded in prose.
function isFieldLine(line: string): boolean {
  return /^[^[\n]*:\s*\[[A-Z][A-Z0-9 ./_-]*\]\s*$/.test(line.trim());
}

// Inline text → nodes: **bold** and auto-linked bare URLs.
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let n = 0;
  for (const p of text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s]+)/g)) {
    if (!p) continue;
    const bold = p.match(/^\*\*([^*]+)\*\*$/);
    if (bold) {
      out.push(<strong key={`${keyBase}-${n++}`}>{bold[1]}</strong>);
    } else if (/^https?:\/\//.test(p)) {
      out.push(
        <a
          key={`${keyBase}-${n++}`}
          href={p}
          target="_blank"
          rel="noreferrer"
          className="link link-primary break-all"
        >
          {p}
        </a>,
      );
    } else {
      out.push(<Fragment key={`${keyBase}-${n++}`}>{p}</Fragment>);
    }
  }
  return out;
}

function PlaceholderChip({
  text,
  interactive,
  onRemove,
  onFillDate,
}: {
  text: string;
  interactive: boolean;
  onRemove?: () => void;
  onFillDate?: () => void;
}) {
  return (
    <span className="draft-placeholder inline-flex items-center gap-1 align-baseline">
      {text}
      {interactive && onFillDate && (
        <button
          type="button"
          onClick={onFillDate}
          title="Insert today's date"
          aria-label="Insert today's date"
          className="inline-flex hover:text-amber-950"
        >
          <CalendarDays className="h-3 w-3" />
        </button>
      )}
      {interactive && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove this line"
          aria-label="Remove this line"
          className="inline-flex hover:text-error"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

interface Props {
  content: string;
  // Whether placeholder buttons are active (off while sending / read-only).
  interactive: boolean;
  // Called with the new full content when a placeholder is removed/filled.
  onChange: (next: string) => void;
}

export default function DraftView({ content, interactive, onChange }: Props) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');

  const removeLine = (idx: number) => onChange(lines.filter((_, i) => i !== idx).join('\n'));
  const fillDate = (idx: number) =>
    onChange(lines.map((l, i) => (i === idx ? l.replace('[DATE]', todayUK()) : l)).join('\n'));

  // Render one source line's inline content: bold + interactive placeholders.
  function renderLine(line: string, idx: number): ReactNode {
    const fieldLine = isFieldLine(line);
    const nodes: ReactNode[] = [];
    let last = 0;
    let k = 0;
    for (const m of line.matchAll(PLACEHOLDER_RE)) {
      const offset = m.index ?? 0;
      if (offset > last) nodes.push(...renderInline(line.slice(last, offset), `l${idx}-${k++}`));
      const token = m[0];
      nodes.push(
        <PlaceholderChip
          key={`l${idx}-ph${k++}`}
          text={token}
          interactive={interactive}
          onFillDate={token === '[DATE]' ? () => fillDate(idx) : undefined}
          onRemove={fieldLine && token !== '[DATE]' ? () => removeLine(idx) : undefined}
        />,
      );
      last = offset + token.length;
    }
    if (last < line.length) nodes.push(...renderInline(line.slice(last), `l${idx}-${k++}`));
    return nodes;
  }

  // A list item with a hover × to remove it — used for the missing-materials
  // list (and any list) so the lawyer can prune items.
  const listItem = (idx: number, text: string) => (
    <li key={`li${idx}`} className="group/li flex items-start gap-1">
      <span className="flex-1">{renderLine(text, idx)}</span>
      {interactive && (
        <button
          type="button"
          onClick={() => removeLine(idx)}
          title="Remove this item"
          aria-label="Remove this item"
          className="opacity-0 group-hover/li:opacity-100 hover:text-error shrink-0 mt-0.5"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </li>
  );

  // Group lines into blocks (heading / hr / list / paragraph), keeping the
  // original line index so placeholder edits map back to the right line.
  const blocks: ReactNode[] = [];
  let para: number[] = [];
  let b = 0;
  const flushPara = () => {
    if (!para.length) return;
    const idxs = para;
    para = [];
    blocks.push(
      <p key={`p${b++}`}>
        {idxs.map((i, j) => (
          <Fragment key={`p${b}-${i}`}>
            {j > 0 && <br />}
            {renderLine(lines[i], i)}
          </Fragment>
        ))}
      </p>,
    );
  };

  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === '') {
      flushPara();
      i += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flushPara();
      blocks.push(<hr key={`hr${b++}`} />);
      i += 1;
      continue;
    }
    const atx = t.match(/^#{1,6}\s+(.*)$/);
    const heading = t.match(/^\*\*(.+?)\*\*:?$/);
    if (atx) {
      flushPara();
      blocks.push(<h4 key={`h${b++}`}>{renderInline(atx[1], `h${b}`)}</h4>);
      i += 1;
      continue;
    }
    if (heading && !heading[1].includes('**')) {
      flushPara();
      blocks.push(<h4 key={`h${b++}`}>{renderLine(`**${heading[1]}**`, i)}</h4>);
      i += 1;
      continue;
    }
    if (/^[-*]\s+/.test(t)) {
      flushPara();
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        const idx = i;
        items.push(listItem(idx, lines[idx].trim().replace(/^[-*]\s+/, '')));
        i += 1;
      }
      blocks.push(<ul key={`ul${b++}`}>{items}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      flushPara();
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const idx = i;
        items.push(listItem(idx, lines[idx].trim().replace(/^\d+\.\s+/, '')));
        i += 1;
      }
      blocks.push(<ol key={`ol${b++}`}>{items}</ol>);
      continue;
    }
    para.push(i);
    i += 1;
  }
  flushPara();

  return <>{blocks}</>;
}
