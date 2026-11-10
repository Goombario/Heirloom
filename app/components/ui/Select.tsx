'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from '@/lib/icons';
import { cx } from './cx';
import { fieldClass } from './Input';

interface SelectOption<T> {
  /** Stable React key. */
  key: string;
  value: T;
  label: React.ReactNode;
  /** Muted trailing text, such as a count. */
  meta?: React.ReactNode;
  /** A heading the option is listed under; consecutive options share one. */
  group?: string;
}

interface SelectProps<T> {
  /** Muted prefix shown before the value (e.g. "Action"). */
  label: string;
  /** The current value's display node. */
  valueLabel: React.ReactNode;
  options: SelectOption<T>[];
  /** True for the option matching the current value (rendered with a check + tint). */
  isSelected: (value: T) => boolean;
  onSelect: (value: T) => void;
  /** Optional leading icon in the trigger. */
  icon?: React.ReactNode;
  /** Accessible name for the trigger (defaults to `label`). */
  ariaLabel?: string;
  /** Optional classes applied to each option button. */
  optionClassName?: string;
  /** Optional classes applied to the trigger button. */
  triggerClassName?: string;
  className?: string;
  /** A muted note under the options, outside the listbox. */
  footer?: React.ReactNode;
}

const PANEL = 'absolute top-[calc(100%+6px)] left-0 z-[41] min-w-[190px] p-1.5 bg-card border border-border rounded-[10px]';
const OPTION = 'flex items-center justify-between gap-2 w-full text-left px-2.5 py-1.5 rounded-[7px] text-sm cursor-pointer hover:bg-[color:var(--color-hover-surface)] focus-visible:outline-none focus-visible:bg-[color:var(--color-hover-surface)]';

/**
 * A compact label + value dropdown — the trigger-button + popover-listbox pattern
 * the audit filter bar hand-rolled (`DROPDOWN_STYLE`/`OPT_STYLE`) for its Action/Who
 * filters (#175 Wave 4). Adds `listbox`/`option` roles the originals lacked; closes
 * on outside-click and Escape.
 */
export function Select<T>({ label, valueLabel, options, isSelected, onSelect, icon, ariaLabel, optionClassName = '', triggerClassName = '', className = '', footer }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  // Consecutive options with the same `group` sit in one labelled group.
  const groups: Array<{ label?: string; options: SelectOption<T>[] }> = [];
  for (const opt of options) {
    const last = groups[groups.length - 1];
    if (last && last.label === opt.group) last.options.push(opt);
    else groups.push({ label: opt.group, options: [opt] });
  }
  const renderOption = (opt: SelectOption<T>) => {
    const active = isSelected(opt.value);
    return (
      <button
        key={opt.key}
        type="button"
        role="option"
        aria-selected={active}
        onClick={() => { onSelect(opt.value); setOpen(false); }}
        className={cx(OPTION, optionClassName, active && 'bg-surface-2')}
      >
        <span className="inline-flex items-center gap-2">{opt.label}</span>
        <span className="inline-flex items-center gap-2">
          {opt.meta != null && <span className="font-mono text-xs text-text-muted">{opt.meta}</span>}
          {active && <Check size={14} aria-hidden className="text-text" />}
        </span>
      </button>
    );
  };
  return (
    <div className={cx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cx('inline-flex items-center gap-1.5 min-h-8 px-2.5 py-1 rounded-lg bg-card border border-border text-meta text-text cursor-pointer transition-colors hover:border-primary focus-ring', triggerClassName)}
      >
        {icon}
        <span className="text-text-muted">{label}</span>
        <span className="font-semibold">{valueLabel}</span>
        <ChevronDown size={14} aria-hidden className="text-text-muted" />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-40" aria-hidden="true" />
          <div
            className={PANEL}
            style={{ boxShadow: 'var(--shadow-lg)' }}
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          >
            <div role="listbox" aria-label={label}>
              {groups.map((g, i) => g.label == null
                ? g.options.map(renderOption)
                : (
                  <div key={`${g.label}-${i}`} role="group" aria-label={g.label}>
                    <div aria-hidden="true" className="eyebrow px-2.5 pt-2 pb-1">{g.label}</div>
                    {g.options.map(renderOption)}
                  </div>
                ))}
            </div>
            {footer && <div className="mt-1.5 border-t border-border px-2.5 pt-2 pb-1 text-meta text-text-muted">{footer}</div>}
          </div>
        </>
      )}
    </div>
  );
}

interface SelectFieldOption<V extends string> {
  value: V;
  label: string;
}

interface SelectFieldGroup<V extends string> {
  /** Stable key for the group. */
  key: string;
  label: string;
  options: readonly SelectFieldOption<V>[];
}

interface SelectFieldProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  /** Flat options. Pass `groups` instead for a grouped list. */
  options?: readonly SelectFieldOption<V>[];
  /** Grouped options with a heading each (the native `<optgroup>`). */
  groups?: readonly SelectFieldGroup<V>[];
  /** The trigger's id, so a `<label htmlFor>` names it. */
  id?: string;
  'aria-label'?: string;
  size?: 'sm' | 'md';
  /** One width utility for the trigger, as for `fieldClass` (default `w-full`). */
  width?: string;
  /** Replaces the field chrome entirely (a caller that already builds a `fieldClass`). */
  fieldClassName?: string;
  className?: string;
  disabled?: boolean;
}

// `pointer-events-auto`: inside a Vaul sheet, Radix sets `pointer-events: none` on
// <body>, and this list portals there, so taps fell through to the sheet (MB-1).
const FIELD_PANEL = 'fixed z-[90] pointer-events-auto max-h-[280px] overflow-y-auto overscroll-contain p-1 bg-card border border-border rounded-[10px]';
const FIELD_OPTION = 'flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-[7px] text-sm text-text cursor-pointer';
const PANEL_MAX = 280;

/**
 * The form-field mode of the Select family (#770, CT-4): a drop-in for a native
 * `<select>` that shares the field chrome (`fieldClass` heights and radius) and the
 * listbox look of `Select`. It is the WAI-ARIA "select-only combobox": focus stays
 * on the trigger, and `aria-activedescendant` points at the highlighted option.
 *
 * - ↓/↑/Enter/Space/Home/End open it; typing a letter opens it on the first match.
 * - Open: ↓/↑ move, Home/End and PageUp/PageDown jump, typing jumps by prefix,
 *   Enter/Space choose, Tab chooses and moves on, Escape closes without choosing.
 * - The list is portalled to `<body>` with fixed positioning, so a scrolling panel
 *   or modal can't clip it, and a wrapping `<label>` doesn't re-click the trigger
 *   when an option is picked. It opens upward when there's no room below, follows
 *   the trigger through scrolls and resizes, and closes on an outside press or blur.
 */
export function SelectField<V extends string>({
  value, onChange, options, groups, id, 'aria-label': ariaLabel, size = 'md', width = 'w-full',
  fieldClassName, className, disabled = false,
}: SelectFieldProps<V>) {
  const baseId = React.useId();
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const flat = React.useMemo(
    () => groups ? groups.flatMap((g) => g.options) : (options ?? []),
    [groups, options],
  );
  const selectedIndex = flat.findIndex((o) => o.value === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; minWidth: number; maxWidth: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const typed = React.useRef({ text: '', at: 0 });

  const place = React.useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    // Never past the viewport's right edge: long labels wrap instead.
    const x = { left: r.left, minWidth: r.width, maxWidth: Math.max(r.width, window.innerWidth - r.left - 8) };
    setPos(below < PANEL_MAX + 8 && r.top > below
      ? { ...x, bottom: window.innerHeight - r.top + 4 }
      : { ...x, top: r.bottom + 4 });
  }, []);

  function openAt(index: number) {
    if (disabled) return;
    place();
    setActive(index);
    setOpen(true);
  }

  function choose(index: number) {
    const opt = flat[index];
    setOpen(false);
    if (opt && opt.value !== value) onChange(opt.value);
  }

  // Type-ahead: letters typed within half a second build one prefix.
  function matchTyped(key: string, from: number): number {
    const now = Date.now();
    typed.current = { text: now - typed.current.at < 500 ? typed.current.text + key : key, at: now };
    const prefix = typed.current.text.toLowerCase();
    const start = prefix.length === 1 ? from + 1 : from;
    for (let n = 0; n < flat.length; n++) {
      const i = (start + n + flat.length) % flat.length;
      if (flat[i].label.toLowerCase().startsWith(prefix)) return i;
    }
    return -1;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const last = flat.length - 1;
    const printable = e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!open) {
      const at = selectedIndex < 0 ? 0 : selectedIndex;
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openAt(at); }
      else if (e.key === 'Home') { e.preventDefault(); openAt(0); }
      else if (e.key === 'End') { e.preventDefault(); openAt(last); }
      else if (printable) { const i = matchTyped(e.key, at); if (i >= 0) { e.preventDefault(); openAt(i); } }
      return;
    }
    const move = (i: number) => { e.preventDefault(); setActive(Math.max(0, Math.min(last, i))); };
    switch (e.key) {
      case 'ArrowDown': return e.altKey ? undefined : move(active + 1);
      case 'ArrowUp': if (e.altKey) { e.preventDefault(); choose(active); return; } return move(active - 1);
      case 'Home': return move(0);
      case 'End': return move(last);
      case 'PageDown': return move(active + 10);
      case 'PageUp': return move(active - 10);
      case 'Enter': case ' ': e.preventDefault(); choose(active); return;
      case 'Tab': choose(active); return;
      // Stop here so an enclosing modal's document-level Escape doesn't also close it.
      case 'Escape': e.preventDefault(); e.stopPropagation(); setOpen(false); return;
      default:
        if (printable) { const i = matchTyped(e.key, active); if (i >= 0) move(i); }
    }
  }

  // Keep the highlighted option in view as the keyboard walks the list.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    // Follow the trigger rather than close: a smooth scroll that brings the field
    // into view is still running when the list opens.
    const onScroll = (e: Event) => { if (!listRef.current?.contains(e.target as Node)) place(); };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const renderOption = (opt: SelectFieldOption<V>, i: number) => {
    const selected = opt.value === value;
    return (
      <div
        key={opt.value}
        id={optionId(i)}
        role="option"
        aria-selected={selected}
        data-active={i === active || undefined}
        data-value={opt.value}
        onClick={() => choose(i)}
        onMouseMove={() => { if (active !== i) setActive(i); }}
        className={cx(FIELD_OPTION, i === active && 'bg-[color:var(--color-hover-surface)]', selected && 'font-semibold')}
      >
        <span>{opt.label}</span>
        {selected && <Check size={14} aria-hidden className="shrink-0 text-text" />}
      </div>
    );
  };

  let index = 0;
  const list = open && pos && typeof document !== 'undefined' ? createPortal(
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      // Named like its trigger: the aria-label, else the trigger's <label> text.
      aria-label={ariaLabel ?? triggerRef.current?.labels?.[0]?.textContent ?? undefined}
      // Keep focus on the trigger, where the combobox's keyboard lives, even when
      // an option or the list's scrollbar is pressed.
      onMouseDown={(e) => e.preventDefault()}
      className={FIELD_PANEL}
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.minWidth, maxWidth: pos.maxWidth, boxShadow: 'var(--shadow-lg)' }}
    >
      {groups
        ? groups.map((g) => (
          <div key={g.key} role="group" aria-labelledby={`${baseId}-g-${g.key}`}>
            <div id={`${baseId}-g-${g.key}`} role="presentation" className="eyebrow px-2.5 pt-2 pb-1">{g.label}</div>
            {g.options.map((opt) => renderOption(opt, index++))}
          </div>
        ))
        : flat.map((opt, i) => renderOption(opt, i))}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        // The raw value, for scripts and tests that can't map a translated label back.
        data-value={value}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex < 0 ? 0 : selectedIndex))}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        className={cx(
          fieldClassName ?? fieldClass(size, width),
          'inline-flex items-center justify-between gap-2 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
      >
        {/* A label can carry a time-dependent part (a time zone's current offset),
            so a prerendered value may differ from the client's. */}
        <span className="truncate" suppressHydrationWarning>{flat[selectedIndex]?.label ?? value}</span>
        <ChevronDown size={14} aria-hidden className="shrink-0 text-text-muted" />
      </button>
      {list}
    </>
  );
}
