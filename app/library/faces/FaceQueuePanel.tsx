'use client';

import { useTranslations } from 'next-intl';
import { Button, SegmentedControl } from '@/app/components/ui';
import { cx } from '@/app/components/ui/cx';
import LibraryPanel from '@/app/library/sections/LibraryPanel';
import { faceStateLabel } from './FaceDecisionRows';
import type { FaceRow } from './faceRows';

/** A stable fragment target for a face row. */
export function faceQueueGroupAnchor(key: string): string {
  return `face-queue-group-${encodeURIComponent(key)}`;
}

/**
 * The Faces tab's floating panel (#1156, on the #1152 LibraryPanel): what is waiting,
 * Waiting / Resolved, Jump to each row, and Confirm all as the page's one copper button.
 */
export default function FaceQueuePanel({
  rows, pendingTotal, resolvedView, confirmAllCount, bulkBusy, canEdit, activeKey, onJump, onViewChange, onConfirmAll,
}: {
  rows: FaceRow[];
  pendingTotal: number;
  resolvedView: boolean;
  /** Faces Confirm all would tag: rows with a known person, never a shared name. */
  confirmAllCount: number;
  bulkBusy: boolean;
  canEdit: boolean;
  activeKey: string | null;
  onJump: (key: string) => void;
  onViewChange: (resolved: boolean) => void;
  onConfirmAll: () => void;
}) {
  const ft = useTranslations('faceTags');
  const tc = useTranslations('common');

  return (
    <LibraryPanel label={ft('panel_label')} testId="library-faces-panel" className="flex flex-col">
      <h2 className="serif m-0 px-2 pb-2.5 text-base font-semibold leading-tight text-text">
        {ft('rail_summary', { faces: pendingTotal, groups: rows.length })}
      </h2>
      <SegmentedControl
        aria-label={ft('filter_label')}
        value={resolvedView ? 'resolved' : 'pending'}
        onChange={(view) => onViewChange(view === 'resolved')}
        options={[
          { v: 'pending', l: ft('filter_pending') },
          { v: 'resolved', l: ft('filter_resolved_short') },
        ]}
        fullWidth
        className="bg-surface"
      />

      {!resolvedView && rows.length > 0 && (
        <nav aria-label={ft('rail_jump_to')} className="mt-3.5 flex flex-col gap-0.5">
          <div className="eyebrow mb-1.5 ml-2">{ft('rail_jump_to')}</div>
          {rows.map((row) => {
            const name = row.group.sourceName ?? tc('unknown');
            const active = row.key === activeKey;
            return (
              <a
                key={row.key}
                href={`#${faceQueueGroupAnchor(row.key)}`}
                onClick={(e) => { e.preventDefault(); onJump(row.key); }}
                aria-current={active ? 'true' : undefined}
                className={cx(
                  'flex flex-col gap-px rounded-md px-2 py-1.5 text-left no-underline transition-colors focus-ring',
                  active ? 'bg-card shadow-[var(--shadow-sm)]' : 'hover:bg-card',
                )}
              >
                <span className="serif truncate text-sm font-semibold text-text">{name}</span>
                <span className="flex justify-between gap-2 text-xs text-text-muted">
                  <span className="truncate">{faceStateLabel(ft, row.kind, row.sharedBy.length || row.group.ambiguousPersonCount || 0)}</span>
                  <span className="shrink-0 tabular-nums">{ft('group_faces_count', { count: row.candidates.length })}</span>
                </span>
              </a>
            );
          })}
        </nav>
      )}

      {canEdit && !resolvedView && confirmAllCount > 0 && (
        <Button variant="primary" block className="mt-4" disabled={bulkBusy} onClick={onConfirmAll}>
          {ft('action_confirm_all', { count: confirmAllCount })}
        </Button>
      )}
    </LibraryPanel>
  );
}
