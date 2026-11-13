'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cx } from './cx';

export interface Column<T> {
  /** Stable id; used as the sort key emitted by onSortChange. */
  key: string;
  header: ReactNode;
  /** When true, the header is clickable and shows a sort indicator. */
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string | number;
  /** Applied to each body <td>. */
  className?: string;
  /** Applied to the <th>. */
  headerClassName?: string;
  render: (row: T) => ReactNode;
}

interface DataTableSelection<T> {
  selected: Set<string | number>;
  onToggle: (key: string | number) => void;
  allSelected: boolean;
  onToggleAll: () => void;
  /** Omit the row checkbox when that record cannot participate in this bulk action. */
  isRowSelectable?: (row: T) => boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /** Controlled sort state — the table only reflects it and emits onSortChange. */
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSortChange?: (key: string) => void;
  /** Optional leading checkbox column. */
  selection?: DataTableSelection<T>;
  /** Rendered (spanning all columns) when rows is empty. */
  empty?: ReactNode;
  className?: string;
  /** Merged into the <table> style (e.g. `{ minWidth: 720 }`). */
  style?: CSSProperties;
  rowClassName?: (row: T) => string | undefined;
  /**
   * Fired on row hover or when focus enters the row (keyboard nav) — use to
   * prefetch that row's detail so a click paints instantly. Fires at most on
   * pointer/focus intent, not per render.
   */
  onRowPrefetch?: (row: T) => void;
  /**
   * `list`: the v1.1 record lists (People, Families; locked list boards): tighter
   * rows with every cell centred on the row, so a name with or without its sub-line
   * reads level with the dates beside it.
   */
  density?: 'default' | 'list';
}

const CHECKBOX_STYLE: CSSProperties = {
  width: 15,
  height: 15,
  accentColor: 'var(--primary)',
  cursor: 'pointer',
  margin: 0,
};

const HEADER_CELL_STYLE: CSSProperties = {
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  borderBottom: '1px solid var(--border)',
};

/** Headers stay on one line from lg. Below it a long label ("Facts sourced",
 *  "Факты с источниками") may take two lines, so a header doesn't set how narrow
 *  its column can get at tablet width (#806, T-2). */
const HEADER_WRAP = 'lg:whitespace-nowrap';

/**
 * Shared desktop table primitive. Sorting is **controlled**: the consumer owns
 * the comparator and passes the resulting `rows` plus the current `sort` state,
 * and the table emits `onSortChange(key)` on header clicks. It renders the
 * desktop `<table>` only — pair it with a bespoke mobile card list.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  selection,
  empty,
  className,
  style,
  rowClassName,
  onRowPrefetch,
  density = 'default',
}: DataTableProps<T>) {
  const tc = useTranslations('common');
  const totalCols = columns.length + (selection ? 1 : 0);
  const hasSelectableRows = selection
    ? rows.some(row => selection.isRowSelectable?.(row) ?? true)
    : false;

  return (
    <table className={className} style={{ width: '100%', borderCollapse: 'collapse', ...style }}>
      <thead>
        <tr style={{ background: 'var(--card-alt)' }}>
          {selection && (
            <th className="w-[38px]" style={{ ...HEADER_CELL_STYLE, textAlign: 'left', paddingLeft: 14 }}>
              <input
                type="checkbox"
                aria-label={tc('select_all')}
                checked={selection.allSelected}
                onChange={selection.onToggleAll}
                disabled={!hasSelectableRows}
                style={CHECKBOX_STYLE}
              />
            </th>
          )}
          {columns.map((col) => {
            const active = sort?.key === col.key;
            const arrow = active ? (sort!.dir === 'asc' ? '↑' : '↓') : '↕';
            return (
              <th
                key={col.key}
                className={[
                  HEADER_WRAP,
                  col.headerClassName,
                  col.sortable ? 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset' : undefined,
                ].filter(Boolean).join(' ') || undefined}
                aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                onClick={col.sortable ? () => onSortChange?.(col.key) : undefined}
                onKeyDown={col.sortable ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSortChange?.(col.key);
                  }
                } : undefined}
                tabIndex={col.sortable ? 0 : undefined}
                style={{
                  ...HEADER_CELL_STYLE,
                  textAlign: col.align ?? 'left',
                  width: col.width,
                  color: active ? 'var(--link)' : 'var(--text-muted)',
                  cursor: col.sortable ? 'pointer' : undefined,
                  userSelect: col.sortable ? 'none' : undefined,
                }}
              >
                <span className="gap-[5px]" style={{ display: 'inline-flex', alignItems: 'center' }}>
                  {col.header}
                  {col.sortable && (
                    <span aria-hidden className="text-xs leading-[1]" style={{ opacity: active ? 1 : 0.4 }}>
                      {arrow}
                    </span>
                  )}
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={totalCols} style={{ padding: 0 }}>
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((row, i) => {
            const key = rowKey(row);
            const selected = selection?.selected.has(key) ?? false;
            const selectable = selection?.isRowSelectable?.(row) ?? true;
            return (
              <tr
                key={key}
                className={cx('dt-row', rowClassName?.(row))}
                style={{ borderTop: i === 0 ? undefined : '1px solid var(--border-light)' }}
                onMouseEnter={onRowPrefetch ? () => onRowPrefetch(row) : undefined}
                onFocus={onRowPrefetch ? () => onRowPrefetch(row) : undefined}
              >
                {selection && (
                  <td className="py-3 pr-3 pl-3.5">
                    {selectable && (
                      <input
                        type="checkbox"
                        aria-label={tc('select_row')}
                        checked={selected}
                        onChange={() => selection.onToggle(key)}
                        style={CHECKBOX_STYLE}
                      />
                    )}
                  </td>
                )}
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={col.className}
                    style={{ padding: density === 'list' ? '8px 12px' : '10px 12px', textAlign: col.align ?? 'left', verticalAlign: density === 'list' ? 'middle' : 'top' }}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
