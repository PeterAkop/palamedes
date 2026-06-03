import CaseSidebar from '@/components/cases/CaseSidebar';
import { buildSidebarItems } from '@/data/cases';

// Render every /cases route on demand rather than statically. The
// sidebar's URL-state hook (useSearchParams) can't run at build time
// without a Suspense boundary, and there's nothing to prerender behind
// the auth fence anyway.
export const dynamic = 'force-dynamic';

// Sidebar layout for everything under /cases. The sidebar's collapsed
// state is tracked client-side in the URL (?sidebar=hidden); we render
// both sides unconditionally and let CSS/JS handle the visual collapse
// so the URL is the single source of truth.
export default function CasesLayout({ children }: { children: React.ReactNode }) {
  const sidebarItems = buildSidebarItems();
  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex gap-6 items-start">
        <div className="shrink-0">
          <CaseSidebar sidebarItems={sidebarItems} />
        </div>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
