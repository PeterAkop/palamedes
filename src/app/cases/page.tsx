import { FolderOpen } from 'lucide-react';

export default function CasesIndexPage() {
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body items-center text-center py-16">
        <div className="p-4 bg-base-200 rounded-full mb-3">
          <FolderOpen className="h-10 w-10 text-base-content/40" />
        </div>
        <h2 className="card-title">Select a case</h2>
        <p className="text-base-content/60 max-w-sm">
          Pick a case from the list on the left to see its overview, sources, and tools.
        </p>
      </div>
    </div>
  );
}
