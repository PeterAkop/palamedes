'use client';

import { FolderUp, Loader2, Upload } from 'lucide-react';
import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from 'react';
import { ACCEPT_ATTR, collectDroppedFiles } from '@/lib/upload/collect';
import { useBulkUpload } from './useBulkUpload';

// Upload affordance for the Sources tab. Supports:
//  - picking one or many files (multiple)
//  - picking a whole folder (webkitdirectory) — for cases with lots of docs
//  - dropping files OR a folder onto the button (recurses subfolders)
// Files upload through a concurrency pool (see useBulkUpload); the button
// shows live "Uploading n/N" progress. Sources land as `processing` and the
// Sources list updates as analysis completes.

interface Props {
  caseId: string;
}

export default function UploadButton({ caseId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const { upload, isUploading, progress, error } = useBulkUpload(caseId);

  // `webkitdirectory` isn't a typed React prop — set it on the folder input
  // imperatively so the picker selects an entire directory.
  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute('webkitdirectory', '');
      folderRef.current.setAttribute('directory', '');
    }
  }, []);

  function onPicked(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-selecting the same files
    if (files.length > 0) void upload(files);
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (isUploading) return;
    const files = await collectDroppedFiles(e.dataTransfer);
    if (files.length > 0) void upload(files);
  }

  const label = isUploading
    ? progress
      ? `Uploading ${progress.done}/${progress.total}…`
      : 'Uploading…'
    : 'Upload';

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs text-error max-w-[14rem] truncate" title={error}>
          {error}
        </span>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        onChange={onPicked}
        disabled={isUploading}
        className="hidden"
      />
      {/* Folder picker — selects every file in the chosen directory; we
          filter to supported types client-side. */}
      <input
        ref={folderRef}
        type="file"
        multiple
        onChange={onPicked}
        disabled={isUploading}
        className="hidden"
      />

      {/* The button group is itself a drop target. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-drop zone wrapping the upload buttons (clicking the buttons remains the keyboard path) */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!isUploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex items-center gap-1 rounded-md transition ${
          dragOver ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-100' : ''
        }`}
        title="Drop files or a folder here"
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={isUploading}
          className="btn btn-sm btn-primary gap-1"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {label}
        </button>
        <button
          type="button"
          onClick={() => folderRef.current?.click()}
          disabled={isUploading}
          title="Upload a folder"
          aria-label="Upload a folder"
          className="btn btn-sm btn-ghost btn-square"
        >
          <FolderUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
