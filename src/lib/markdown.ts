// Minimal Markdown → HTML for the letter/email drafts the tools produce.
// Pure (no deps), so it's used both to render the preview in the app and
// to format the outgoing email. Handles the small subset the drafts use:
// whole-line bold as a heading, inline bold, ordered/unordered lists,
// horizontal rules, and paragraphs. Everything is HTML-escaped first, so
// it's safe to inject.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline formatting within a line: auto-link bare URLs, then **bold**.
function inline(s: string): string {
  return escapeHtml(s)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export function renderMarkdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      // Join with <br> so intentional single line breaks (address blocks,
      // reference lines, signatures) stack vertically rather than collapse.
      out.push(`<p>${para.map(inline).join('<br />')}</p>`);
      para = [];
    }
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
      out.push('<hr />');
      i += 1;
      continue;
    }
    // ATX heading (#..######) — render all as h4 for a consistent look.
    const atx = t.match(/^#{1,6}\s+(.*)$/);
    if (atx) {
      flushPara();
      out.push(`<h4>${inline(atx[1])}</h4>`);
      i += 1;
      continue;
    }
    // Whole-line bold ("**Section**") — treat as a section heading.
    const heading = t.match(/^\*\*(.+?)\*\*:?$/);
    if (heading && !heading[1].includes('**')) {
      flushPara();
      out.push(`<h4>${inline(heading[1])}</h4>`);
      i += 1;
      continue;
    }
    // Unordered list.
    if (/^[-*]\s+/.test(t)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    // Ordered list.
    if (/^\d+\.\s+/.test(t)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    para.push(t);
    i += 1;
  }
  flushPara();
  return out.join('\n');
}

// A placeholder is an ALL-CAPS bracketed token the drafting tools insert
// for details they couldn't fill, e.g. [OUR REFERENCE], [FEE FIGURE].
const PLACEHOLDER_RE = /\[[A-Z][A-Z0-9 ./_-]*\]/g;

// The distinct placeholders still present in the content (for the send
// guard / warning).
export function findPlaceholders(text: string): string[] {
  return [...new Set(text.match(PLACEHOLDER_RE) ?? [])];
}

// Wrap placeholders in <mark> for the preview so the lawyer can spot what
// still needs filling in. Run on already-rendered HTML (placeholders have
// no special chars, so they survive escaping untouched).
export function highlightPlaceholders(html: string): string {
  return html.replace(PLACEHOLDER_RE, '<mark class="draft-placeholder">$&</mark>');
}
