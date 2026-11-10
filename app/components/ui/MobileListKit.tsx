'use client';

import React, { useLayoutEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Menu, Search, X } from '@/lib/icons';
import { openAppMenu, openGlobalSearch } from '@/app/components/nav/appEvents';
import { useHideOnScroll } from '@/app/hooks/useHideOnScroll';
import { cx } from './cx';
import { FilterChip, type FilterChipProps } from './FilterChip';
import { GlassButton } from './MobileControls';
import { SegmentedControl } from './SegmentedControl';
import { Sheet } from './Sheet';

/*
 * The mobile list page kit (#1058). The locked people list is the standard for every
 * list page (design-system.md → Mobile → List pages): a one-row dark header, a filter
 * field and chips that slide away on scroll down, a count and sort row opening a Sort
 * by sheet, dividers that follow the sort, pages of 50, and the floating copper pill
 * (`CopperPill floating`). Everything here renders below `md` only.
 */

/**
 * The one dark row: menu, the page name in serif 22, global search. It never scrolls
 * away. While it is mounted the app top bar hides on phones and `--nav-h` becomes its
 * height, so sticky parts below clear it.
 */
export function MobileListHeader({ title, lead, trail }: {
  title: React.ReactNode;
  /** Replaces the menu button. Not with Back: the top-left is the menu on every phone page. */
  lead?: React.ReactNode;
  /** Replaces global search (the tree's find and display buttons). */
  trail?: React.ReactNode;
}) {
  const tn = useTranslations('nav');
  const tc = useTranslations('common');
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-own-header', '');
    return () => root.removeAttribute('data-own-header');
  }, []);
  return (
    <header
      className="md:hidden hero-dark mp-slim-bar sticky top-0 z-40 flex items-center gap-3 h-[calc(54px+var(--sat))] pt-[var(--sat)] pb-0 px-3 rounded-none shadow-none"
    >
      {lead ?? <GlassButton label={tn('toggle_menu')} icon={<Menu />} onClick={openAppMenu} />}
      <h1 className="flex-1 min-w-0 m-0 truncate serif text-xl font-semibold text-white">{title}</h1>
      {trail ?? <GlassButton label={tc('search_people_and_families')} icon={<Search />} onClick={openGlobalSearch} />}
    </header>
  );
}

interface MobileListFiltersProps {
  /** The field's value: narrows this list (not the global search). */
  value: string;
  onChange: (value: string) => void;
  /** Names what it filters, e.g. "Filter by name or place". */
  placeholder: string;
  /** The chips (`MobileListChip`), in one sideways-scrolling row. */
  children?: React.ReactNode;
}

/**
 * The filter field and chips under the header. They slide away while you scroll down
 * and return on a flick up, and stay put while the field has focus.
 */
export function MobileListFilters({ value, onChange, placeholder, children }: MobileListFiltersProps) {
  const tc = useTranslations('common');
  const [focused, setFocused] = useState(false);
  const hidden = useHideOnScroll({ pinned: focused });
  return (
    <div
      data-hidden={hidden ? 'true' : undefined}
      className={cx(
        'md:hidden sticky top-[var(--nav-h)] z-30 bg-surface border-b border-border pt-3',
        'transition-transform motion-reduce:transition-none data-[hidden=true]:-translate-y-full',
      )}
    >
      <div className="relative mx-4">
        <Search className="absolute left-[13px] top-[13px] w-[18px] h-[18px] text-text-muted pointer-events-none" aria-hidden="true" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          className="w-full h-11 rounded-full border border-border bg-card pl-10 pr-10 text-md text-text placeholder:text-text-muted input-nozoom focus-ring [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={tc('clear_search')}
            title={tc('clear_search')}
            className="absolute right-1.5 top-1.5 grid place-items-center w-8 h-8 rounded-full bg-surface-2 text-text cursor-pointer focus-ring"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="hscroll-strip flex gap-1.5 overflow-x-auto px-4 pt-2.5 pb-[11px]">{children}</div>
    </div>
  );
}

/**
 * A list filter chip at phone size: plain words, ink fill when on, ✕ only on the
 * active chip, drawn at 34px in a 44px hit. No "All" chip: none on means all.
 */
export function MobileListChip(props: FilterChipProps) {
  // A dismissible chip is a shell holding two buttons, so each button carries its own
  // 44px hit. A positioned ::before on the shell would paint over both and take the tap.
  const hit = props.dismissible
    ? "[&>button]:relative [&>button]:before:absolute [&>button]:before:-inset-y-[6px] [&>button]:before:inset-x-0 [&>button]:before:content-[''] [&>button:last-child]:before:-left-[9px] [&>button:last-child]:before:-right-[10px]"
    : "relative before:absolute before:-inset-y-[5px] before:inset-x-0 before:content-['']";
  return <FilterChip {...props} className={cx('!h-[34px]', hit, props.className)} />;
}

/** A chip that is plain when off and has the ink fill and ✕ when on; a tap on the ✕ clears it. */
export function MobileListToggleChip({ label, on, clearLabel, count, onTap, onClear }: {
  label: string; on: boolean; clearLabel: string; count?: number | null; onTap: () => void; onClear: () => void;
}) {
  return on
    ? <MobileListChip label={label} count={count} active dismissible dismissLabel={clearLabel} onClick={onTap} onDismiss={onClear} />
    : <MobileListChip label={label} count={count} onClick={onTap} />;
}

/** The count on the left and the current sort on the right ("Name · A→Z"). */
export function MobileListMeta({ count, sortLabel, onSort }: { count: React.ReactNode; sortLabel?: string; onSort?: () => void }) {
  return (
    <div className="md:hidden flex items-center justify-between gap-3 px-4 pt-3 pb-1 text-meta text-text-muted">
      <span className="font-mono">{count}</span>
      {sortLabel && onSort && (
        <button
          type="button"
          onClick={onSort}
          aria-haspopup="dialog"
          className="min-h-11 -mr-1 pl-2.5 pr-1 text-sm font-semibold text-link cursor-pointer rounded-lg focus-ring"
        >
          {sortLabel}
        </button>
      )}
    </div>
  );
}

/** A divider that follows the sort: a letter, a decade, a town. */
export function MobileListDivider({ children }: { children: React.ReactNode }) {
  return <div className="md:hidden eyebrow px-4 pt-4 pb-1.5">{children}</div>;
}

/** Pages of 50: a full-width Previous / Next row. */
export function MobileListPager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const tc = useTranslations('common');
  if (pages <= 1) return null;
  const link = 'inline-flex items-center gap-1 min-h-12 text-md font-semibold text-link cursor-pointer rounded-lg focus-ring disabled:text-text-muted disabled:opacity-45 disabled:cursor-default';
  return (
    <nav aria-label={tc('pagination')} className="md:hidden flex items-center justify-between px-4 pt-1.5 mt-1 border-t border-border">
      <button type="button" className={link} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="w-[18px] h-[18px]" aria-hidden="true" />{tc('previous')}
      </button>
      <span className="font-mono text-meta text-text-muted">{page} / {pages}</span>
      <button type="button" className={link} disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {tc('next')}<ChevronRight className="w-[18px] h-[18px]" aria-hidden="true" />
      </button>
    </nav>
  );
}

interface SortColumn {
  key: string;
  label: string;
  /** A short line under the label ("Surname, then birth"). */
  hint?: string;
  /** The order switch's two words for this column, ascending first ("A→Z", "Z→A"). */
  orders: [string, string];
}

interface SortSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  columns: SortColumn[];
  column: string;
  ascending: boolean;
  /** Applies at once. A newly picked column starts ascending. */
  onChange: (column: string, ascending: boolean) => void;
}

/**
 * The small Sort by sheet: radio rows that apply at once, then the order switch in the
 * picked column's own words. ✕ or a tap outside closes it. Missing values sort last
 * whichever way (the caller's comparator).
 */
export function SortSheet({ open, onClose, title, columns, column, ascending, onChange }: SortSheetProps) {
  const t = useTranslations('common');
  const current = columns.find(c => c.key === column) ?? columns[0];
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div role="radiogroup" aria-label={title} className="-mx-4 -mt-3">
        {columns.map((c, i) => (
          <RadioRow
            key={c.key}
            checked={c.key === current.key}
            label={c.label}
            hint={c.hint}
            divided={i > 0}
            onSelect={() => onChange(c.key, c.key === current.key ? ascending : true)}
          />
        ))}
      </div>
      <div className="eyebrow pt-4 pb-1">{t('order')}</div>
      <SegmentedControl
        aria-label={t('order')}
        fullWidth
        value={ascending ? 'asc' : 'desc'}
        onChange={(v) => onChange(current.key, v === 'asc')}
        options={[{ v: 'asc', l: current.orders[0] }, { v: 'desc', l: current.orders[1] }]}
      />
    </Sheet>
  );
}

/** A radio row: the choice applies at once (Sort by) or on the sheet's Save (Add family's confirm step). */
export function RadioRow({ checked, label, hint, divided, disabled, onSelect }: {
  checked: boolean; label: string; hint?: string; divided: boolean;
  /** A choice the rules don't allow right now (the last admin's Member), dimmed. */
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        'flex w-full items-center gap-3 px-4 py-[13px] text-left cursor-pointer active:bg-surface-2 focus-ring-inset',
        'disabled:opacity-45 disabled:cursor-default',
        divided && 'border-t border-border',
      )}
    >
      <span
        aria-hidden="true"
        className={cx('w-5 h-5 shrink-0 rounded-full', checked ? 'border-[6px] border-text' : 'border-2 border-text-muted')}
      />
      <span className="flex-1 grid gap-px">
        <span className="text-md text-text">{label}</span>
        {hint && <span className="text-meta text-text-muted">{hint}</span>}
      </span>
    </button>
  );
}

interface ChoiceOption {
  value: string;
  label: string;
  count?: number;
}

interface ChoiceSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The search field's placeholder ("Find a surname"). */
  searchPlaceholder: string;
  /** A heading over the rows ("Most common first"). */
  heading?: string;
  options: ChoiceOption[];
  onPick: (value: string) => void;
  /** Shown when the search matches nothing. */
  emptyLabel: string;
}

/**
 * The bottom sheet a chip opens when it needs a choice (Surname): its own search, then
 * one row per option with its count. A tap picks and closes.
 */
export function ChoiceSheet({ open, onClose, title, searchPlaceholder, heading, options, onPick, emptyLabel }: ChoiceSheetProps) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = fold(query.trim());
    return q ? options.filter(o => fold(o.label).includes(q)) : options;
  }, [options, query]);
  return (
    <Sheet open={open} onClose={() => { setQuery(''); onClose(); }} title={title}>
      <div className="relative">
        <Search className="absolute left-[13px] top-[13px] w-[18px] h-[18px] text-text-muted pointer-events-none" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          autoComplete="off"
          className="w-full h-11 rounded-full border border-border bg-surface pl-10 pr-4 text-md text-text placeholder:text-text-muted input-nozoom focus-ring"
        />
      </div>
      {heading && !query && <div className="eyebrow pt-4 pb-1">{heading}</div>}
      <div className="-mx-4 mt-1">
        {shown.length === 0 ? (
          <p className="m-0 px-4 py-3 text-base text-text-muted">{emptyLabel}</p>
        ) : shown.map((o, i) => (
          <button
            key={o.value}
            type="button"
            onClick={() => { setQuery(''); onPick(o.value); }}
            className={cx(
              'flex w-full items-center gap-3 px-4 py-[13px] text-left text-md text-text cursor-pointer active:bg-surface-2 focus-ring-inset',
              i > 0 && 'border-t border-border',
            )}
          >
            <span className="flex-1 min-w-0 truncate">{o.label}</span>
            {o.count != null && <span className="font-mono text-meta text-text-muted">{o.count}</span>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Case- and accent-insensitive match key. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
