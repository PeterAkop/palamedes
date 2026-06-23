'use client';

import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  CASE_STATUS_LABEL,
  type CaseStatus,
  type ClientOption,
  type SidebarItem,
} from '@/data/cases';
import NewCaseButton from './NewCaseButton';

// Sidebar collapse persisted in the URL — reloads/share-links keep
// whichever state the lawyer left it in. The state lives at the layout
// level (so all routes under /cases share it).

const COLLAPSED_PARAM = 'sidebar';
const COLLAPSED_VALUE = 'hidden';

interface Props {
  sidebarItems: SidebarItem[];
  clients: ClientOption[];
}

export default function CaseSidebar({ sidebarItems, clients }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const collapsed = searchParams.get(COLLAPSED_PARAM) === COLLAPSED_VALUE;

  function toggleCollapsed() {
    const params = new URLSearchParams(searchParams.toString());
    if (collapsed) params.delete(COLLAPSED_PARAM);
    else params.set(COLLAPSED_PARAM, COLLAPSED_VALUE);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }

  // Collapsed shape — render only the expand button so the user has
  // something to click to bring the sidebar back.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggleCollapsed}
        className="btn btn-ghost btn-sm h-full px-1 rounded-none border-r border-base-300 bg-base-100"
        aria-label="Show cases sidebar"
        title="Show cases"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    );
  }

  return (
    <aside className="card bg-base-100 border border-base-300 h-fit w-64">
      <div className="card-body p-3">
        <div className="flex items-center justify-between px-1 py-1">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-base-content/60">
            Cases
          </h2>
          <div className="flex items-center gap-1">
            <NewCaseButton clients={clients} variant="sidebar" />
            <button
              type="button"
              onClick={toggleCollapsed}
              className="btn btn-ghost btn-xs btn-square"
              aria-label="Hide sidebar"
              title="Hide sidebar"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
          </div>
        </div>
        <ul className="menu menu-sm w-full p-0">
          {sidebarItems.map((item) => {
            const href = `/cases/${item.caseId}`;
            const active = pathname === href;
            return (
              <li key={item.caseId} className="my-0.5">
                <Link href={href} className={active ? 'menu-active' : ''}>
                  <FileText className="h-4 w-4 shrink-0 text-base-content/40" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">
                      <span className="font-medium">{item.clientSurname}</span>
                      <span className="text-base-content/40"> — </span>
                      <span>{item.caseTitle}</span>
                    </span>
                  </span>
                  {item.processing > 0 && (
                    <span
                      className="loading loading-spinner loading-xs text-primary shrink-0"
                      title={`Analysing ${item.processing} source${item.processing === 1 ? '' : 's'}`}
                    />
                  )}
                  <StatusDot status={item.caseStatus} />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

// Tiny colored dot indicating case status — kept compact so it doesn't
// crowd the case title in narrow sidebars. Full status label appears
// on hover via title attribute.
function StatusDot({ status }: { status: CaseStatus }) {
  const color =
    status === 'granted'
      ? 'bg-success'
      : status === 'refused'
        ? 'bg-error'
        : status === 'in_progress' || status === 'submitted'
          ? 'bg-warning'
          : status === 'on_hold' || status === 'closed'
            ? 'bg-base-content/30'
            : 'bg-info';
  return (
    <span className={`h-2 w-2 rounded-full shrink-0 ${color}`} title={CASE_STATUS_LABEL[status]} />
  );
}
