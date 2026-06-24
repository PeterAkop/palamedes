// Client-side helpers for bulk/folder uploads: the accepted-extension list
// (mirrors the server allow-list in ingestFile.ts) and recursive file
// collection from a dropped folder.

export const ACCEPTED_EXTENSIONS = [
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'heic',
  'docx',
  'doc',
  'xlsx',
  'xls',
  'txt',
] as const;

// `accept` attribute value for file inputs — same list, dotted.
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',');

export function extOf(name: string): string {
  return name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
}

export function isAcceptedFile(file: File): boolean {
  return ACCEPTED_EXTENSIONS.includes(extOf(file.name) as (typeof ACCEPTED_EXTENSIONS)[number]);
}

// Read every file from a dropped DataTransfer, descending into folders via
// the webkitGetAsEntry directory API (so a lawyer can drop a whole folder).
// Falls back to the flat `files` list when the entry API isn't available.
export async function collectDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((it) => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e != null);

  if (entries.length === 0) return Array.from(dt.files ?? []);

  const out: File[] = [];
  await Promise.all(entries.map((e) => walkEntry(e, out)));
  return out;
}

async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns one batch at a time; loop until it returns none.
    const readBatch = () =>
      new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    let batch = await readBatch();
    while (batch.length > 0) {
      await Promise.all(batch.map((e) => walkEntry(e, out)));
      batch = await readBatch();
    }
  }
}
