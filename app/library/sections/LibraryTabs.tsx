'use client';

import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import type { LibraryView } from '@/app/library/useLibraryTab';

/** The three desktop Library views: Media, Sources and the Faces review queue (#487). */
interface LibraryTabsProps {
  activeTab: LibraryView;
  /**
   * Optional so a page that doesn't have the full library loaded (the Faces
    * shell) can still render the strip: a tab with no count just omits its
   * badge rather than showing a misleading 0.
   *
   * NOTE: a partial record means a missing or misspelled key here is a
   * silently absent badge, not a type error — this component has no way to
   * warn a caller who forgets to pass one. Check call sites by hand.
   *
   * `faces` is the pending-face-queue count (#487 review) — it used to be
   * fetched inside this component, which meant every page rendering the tab
   * strip (including the main Library page) paid an extra query on mount, and
   * the badge went stale after any queue mutation because the fetch only
   * re-ran on `activeTreeId` change. Callers now own fetching/refreshing it
   * and pass it through here like any other tab count.
   */
  tabCounts?: Partial<Record<LibraryView, number>>;
  onSelect: (tab: LibraryView) => void;
}

// Repositories and Uncited were tabs until #444: they are now the Sources panel's
// Repository and Show filters, with Manage repositories at its foot (#1154).
const TAB_ORDER: { id: LibraryView; labelKey: string; namespace?: 'faceTags' }[] = [
  // Media first: it is the tab a bare /library opens (#1157).
  { id: 'photos', labelKey: 'tab_photos_label' },
  { id: 'sources', labelKey: 'tab_sources_label' },
  { id: 'faces', labelKey: 'queue_tab', namespace: 'faceTags' },
];

const TAB_IDS = TAB_ORDER.map(({ id }) => id);

const TAB_BUTTON_CLASS = 'min-h-11 py-[9px] px-2.5 sm:px-3.5 text-sm mb-[-1px] inline-flex items-center gap-1 no-underline focus-ring-inset';

function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    fontFamily: 'inherit',
    cursor: 'pointer',
    color: active ? 'var(--text)' : 'var(--text-2)',
    fontWeight: active ? 600 : 400,
    borderBottom: `2px solid ${active ? 'var(--primary)' : 'transparent'}`,
    whiteSpace: 'nowrap',
  };
}

/**
 * Underline tab strip with per-tab counts. Active tab gets the primary
 * underline + full-strength text.
 *
 * The Faces tab is part of the same shell as the other Library views. Its
 * panel is lazy-loaded by the shell, while its count comes from the caller.
 */
export default function LibraryTabs({ activeTab, tabCounts, onSelect }: LibraryTabsProps) {
  const t = useTranslations('library');
  const ft = useTranslations('faceTags');
  const tabRefs = useRef(new Map<LibraryView, HTMLButtonElement>());

  return (
    <div
      role="tablist"
      className="hscroll-strip flex-wrap sm:flex-nowrap gap-0.5 border-b border-b-[color:var(--border)]"
      style={{ display: 'flex' }}
    >
      {TAB_ORDER.map(({ id, labelKey, namespace }) => {
        const active = activeTab === id;
        const count = tabCounts?.[id];
        const label = namespace === 'faceTags' ? ft(labelKey) : t(labelKey);
        const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
          const index = TAB_IDS.indexOf(id);
          let nextIndex = index;
          if (event.key === 'ArrowRight') nextIndex = (index + 1) % TAB_IDS.length;
          else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TAB_IDS.length) % TAB_IDS.length;
          else if (event.key === 'Home') nextIndex = 0;
          else if (event.key === 'End') nextIndex = TAB_IDS.length - 1;
          else return;
          event.preventDefault();
          const next = TAB_IDS[nextIndex];
          onSelect(next);
          tabRefs.current.get(next)?.focus();
        };
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`library-tab-${id}`}
            ref={(node) => {
              if (node) tabRefs.current.set(id, node);
              else tabRefs.current.delete(id);
            }}
            aria-controls={`library-panel-${id}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(id)}
            onKeyDown={handleKeyDown}
            className={TAB_BUTTON_CLASS}
            style={tabStyle(active)}
          >
            {label}{' '}
            {count !== undefined && <span className="muted font-normal">({count})</span>}
          </button>
        );
      })}
    </div>
  );
}
