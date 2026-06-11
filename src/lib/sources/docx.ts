import { inflateRawSync } from 'node:zlib';

// Extract plain text from a .docx (Office Open XML) buffer using only
// Node built-ins. A .docx is a ZIP whose `word/document.xml` holds the
// body text; we read the ZIP central directory, inflate that one entry,
// and strip the WordprocessingML tags. No external dependency — keeps
// the install surface small for the POC. Good enough to feed Haiku for
// a summary; it does not preserve tables/styles/headers precisely.

// Word .docx MIME — summarised from extracted text rather than via the
// Anthropic Files API (Claude's document block doesn't accept .docx).
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const EOCD_SIG = 0x06054b50; // End of Central Directory record
const CEN_SIG = 0x02014b50; // Central directory file header
const LFH_SIG = 0x04034b50; // Local file header

interface ZipEntry {
  method: number; // 0 = stored, 8 = deflate
  compSize: number;
  localOffset: number;
}

export function extractDocxText(buf: Buffer): string {
  const entry = findEntry(buf, 'word/document.xml');
  if (!entry) return '';
  const xml = readEntry(buf, entry);
  return xmlToText(xml);
}

// Locate the End of Central Directory record by scanning backwards from
// the end (it sits before an optional ≤64 KB comment).
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

// Walk the central directory for the entry with the given name. Central
// directory headers carry the authoritative compressed size + local
// header offset (local headers may defer sizes to a data descriptor).
function findEntry(buf: Buffer, name: string): ZipEntry | null {
  const eocd = findEocd(buf);
  if (eocd < 0) return null;
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const entryName = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (entryName === name) return { method, compSize, localOffset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function readEntry(buf: Buffer, e: ZipEntry): string {
  if (buf.readUInt32LE(e.localOffset) !== LFH_SIG) return '';
  const nameLen = buf.readUInt16LE(e.localOffset + 26);
  const extraLen = buf.readUInt16LE(e.localOffset + 28);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compSize);
  const raw = e.method === 8 ? inflateRawSync(data) : Buffer.from(data);
  return raw.toString('utf8');
}

// Collapse WordprocessingML into readable text: paragraph/line/tab
// markers become whitespace, every other tag is dropped, XML entities
// are decoded. `&amp;` is decoded last so `&amp;lt;` survives intact.
function xmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<w:cr\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
