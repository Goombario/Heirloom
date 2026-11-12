'use client';

import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PersonResult } from '@/lib/db/schema';
import { getDataClient } from '@/lib/data';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import { Check, Plus, Search } from '@/lib/icons';
import { useNoAutofill } from '@/app/hooks/useNoAutofill';
import { Button } from './Button';
import { Lifespan } from './Lifespan';
import { PersonIdentity } from './PersonIdentity';
import { cx } from './cx';

interface FinderSuggestion {
  person: PersonResult;
  /** One line on why ("Same last name; born 7 years after the marriage"). */
  reason?: string;
}

/** What the trigger needs: spread these onto the button that opens the finder. */
interface FinderTriggerProps {
  ref: React.RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  'aria-haspopup': 'dialog';
  'aria-expanded': boolean;
  'aria-controls'?: string;
}

interface Common {
  /** Renders the link or slot that opens the finder ("Find a partner ›", an `EmptySlot`). */
  trigger: (props: FinderTriggerProps) => React.ReactNode;
  /** The popover's accessible name ("Find a partner"). */
  title: string;
  treeId: number | null;
  /** People who can't be picked here (already in the family). */
  excludeIds?: number[];
  /** Shown before anyone types: likely people, each with a reason. */
  suggestions?: FinderSuggestion[];
  /** "Create “<query>” as a new person", listed first once something is typed. */
  onCreate?: (name: string) => void;
  /** Replaces the data client's search (the dev page and tests). */
  search?: (query: string) => Promise<PersonResult[]>;
  /** Which edge of the trigger the popover lines up with. */
  align?: 'start' | 'end';
  className?: string;
}

type Single = Common & { multiple?: false; onPick: (person: PersonResult) => void };
type Multi = Common & {
  multiple: true;
  onPickMany: (people: PersonResult[]) => void;
  /** The footer button ("Add 2 children"). Defaults to "Add N people". */
  addManyLabel?: (count: number) => string;
};

type Option =
  | { kind: 'create'; key: string; name: string }
  | { kind: 'person'; key: string; person: PersonResult; reason?: string };

const nameOf = (p: PersonResult) => displayFullName(p) || '';

/**
 * The popover finder (#55): anchored under the link that opens it, on top of the
 * page or dialog, never replacing what's under it. A search box, then "Create …"
 * first, then suggestions or matches. With `multiple`, rows take checkboxes and the
 * footer adds them all ("Add 2 children").
 *
 * Keyboard: opening focuses the search; ↑/↓ move through the list
 * (`aria-activedescendant`); Enter picks (or ticks, with `multiple`); Escape closes
 * and returns focus to the trigger; tabbing out closes it.
 *
 * Used by Find their parents, Find a partner and Add children (the forms), Add child
 * and Partner unknown (the family page) and Add family (the person page).
 */
export function PersonFinder(props: Single | Multi) {
  const { trigger, title, treeId, excludeIds, suggestions = [], onCreate, search, align = 'start', className } = props;
  const t = useTranslations('detailKit');
  const noAutofill = useNoAutofill();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonResult[] | null>(null);
  const [status, setStatus] = useState<'idle' | 'searching' | 'failed'>('idle');
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<PersonResult[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const popId = `${baseId}-pop`;
  const listId = `${baseId}-list`;
  const optId = (i: number) => `${baseId}-opt-${i}`;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setQuery('');
    setResults(null);
    setStatus('idle');
    setPicked([]);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // The search itself reads the latest props, so a parent passing a fresh
  // `search` or `excludeIds` each render doesn't restart the debounce.
  const runSearch = useEffectEvent(async (q: string) => {
    const found = search
      ? await search(q)
      : (await (await getDataClient()).people.search(q, treeId, 10)) as PersonResult[];
    const skip = new Set(excludeIds ?? []);
    return found.filter((p) => !skip.has(p.Id));
  });

  // Debounced search once two characters are typed.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      setStatus('searching');
      try {
        const found = await runSearch(q);
        if (!live) return;
        setResults(found);
        setStatus('idle');
        setActive(0);
      } catch {
        if (live) { setResults([]); setStatus('failed'); }
      }
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query, open]);

  // An outside press closes without moving focus.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) close(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    // Inside a scrolling dialog body the list can open below the fold: bring it in.
    const pop = wrapRef.current?.querySelector<HTMLElement>('.person-finder');
    if (pop && typeof pop.scrollIntoView === 'function') pop.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const typed = query.trim();
  const options: Option[] = useMemo(() => {
    const list: Option[] = [];
    if (onCreate && typed.length > 0) list.push({ kind: 'create', key: 'create', name: typed });
    const people: FinderSuggestion[] = typed.length >= 2 && results
      ? results.map((person) => ({ person }))
      : typed.length < 2 ? suggestions.filter((sg) => !(excludeIds ?? []).includes(sg.person.Id)) : [];
    for (const s of people) list.push({ kind: 'person', key: `p${s.person.Id}`, person: s.person, reason: s.reason });
    return list;
  }, [onCreate, typed, results, suggestions, excludeIds]);

  const isPicked = (p: PersonResult) => picked.some((x) => x.Id === p.Id);

  const choose = (o: Option) => {
    if (o.kind === 'create') { onCreate?.(o.name); close(true); return; }
    if (props.multiple) {
      setPicked((cur) => (cur.some((x) => x.Id === o.person.Id) ? cur.filter((x) => x.Id !== o.person.Id) : [...cur, o.person]));
      return;
    }
    props.onPick(o.person);
    close(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    // List keys belong to the search box; the footer buttons keep their own Enter.
    if (e.target !== inputRef.current || options.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + options.length) % options.length); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = options[Math.min(active, options.length - 1)]; if (o) choose(o); }
  };

  // Tabbing out of the popover closes it; focus goes where Tab sent it.
  const onBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && !wrapRef.current?.contains(next)) close(false);
  };

  const activeIndex = options.length ? Math.min(active, options.length - 1) : -1;
  const showingSuggestions = typed.length < 2 && suggestions.length > 0;

  return (
    <div ref={wrapRef} className={cx('relative', className)} onBlur={open ? onBlur : undefined}>
      {trigger({
        ref: triggerRef,
        onClick: () => (open ? close(false) : setOpen(true)),
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-controls': open ? popId : undefined,
      })}
      {open && (
        <div
          id={popId}
          role="dialog"
          aria-label={title}
          onKeyDown={onKeyDown}
          className={cx(
            'person-finder absolute top-full z-50 mt-1.5 w-[360px] max-w-[calc(100vw-32px)] rounded-card border border-border bg-card shadow-[var(--shadow-lg)] text-left',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          <div className="flex items-center gap-2 border-b border-border-light px-3 py-2">
            <Search className="w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label={title}
              aria-expanded={options.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex >= 0 ? optId(activeIndex) : undefined}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); if (e.target.value.trim().length < 2) { setResults(null); setStatus('idle'); } }}
              placeholder={t('finder_placeholder')}
              className="input-nozoom flex-1 min-w-0 border-0 bg-transparent py-1 text-base text-text outline-none placeholder:text-text-muted"
              {...noAutofill('person-finder')}
            />
          </div>
          {showingSuggestions && <div className="eyebrow px-3 pt-2.5">{t('finder_suggested')}</div>}
          <div
            id={listId}
            role="listbox"
            aria-label={title}
            aria-multiselectable={props.multiple || undefined}
            className="max-h-[320px] overflow-y-auto p-1.5"
          >
            {options.map((o, i) => {
              const isActive = i === activeIndex;
              if (o.kind === 'create') {
                return (
                  <div key={o.key} id={optId(i)} role="option" aria-selected={isActive}
                    onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)} onMouseEnter={() => setActive(i)}
                    className={cx('flex items-center gap-3 rounded-btn px-2 py-2 cursor-pointer text-sm font-semibold text-link', isActive && 'bg-surface-2')}
                  >
                    <span aria-hidden="true" className="grid place-items-center w-[34px] h-[34px] shrink-0 rounded-full border border-dashed border-[color:var(--color-drop-edge)]"><Plus className="w-4 h-4" /></span>
                    {t('finder_create', { name: o.name })}
                  </div>
                );
              }
              const p = o.person;
              const checked = props.multiple ? isPicked(p) : undefined;
              return (
                <div key={o.key} id={optId(i)} role="option" aria-selected={props.multiple ? checked : isActive}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)} onMouseEnter={() => setActive(i)}
                  className={cx('flex items-center gap-2.5 rounded-btn px-2 py-1.5 cursor-pointer', isActive && 'bg-surface-2')}
                >
                  {props.multiple && (
                    <span aria-hidden="true" className={cx('grid place-items-center w-4 h-4 shrink-0 rounded-[4px] border', checked ? 'bg-segment-on border-segment-on text-on-segment' : 'border-text-muted')}>
                      {checked && <Check className="w-3 h-3" />}
                    </span>
                  )}
                  <span className="grid min-w-0 flex-1">
                    <PersonIdentity
                      as="span"
                      name={nameOf(p)}
                      initials={getInitials(p.FirstName, p.LastName)}
                      sex={p.Sex}
                      mediaId={p.PrimaryMediaId ?? null}
                      focalX={p.FocalX}
                      focalY={p.FocalY}
                      focalRadius={p.FocalRadius}
                      treeId={treeId}
                      lifespan={p.BirthDate || p.DeathDate ? <Lifespan birth={p.BirthDate} death={p.DeathDate} /> : null}
                    />
                    {o.reason && <span className="text-meta text-text-muted pl-[46px]">{o.reason}</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {typed.length >= 2 && status === 'searching' && results == null && (
            <div className="px-3.5 pb-2.5 text-sm text-text-muted" role="status">{t('finder_searching')}</div>
          )}
          {typed.length >= 2 && status === 'failed' && (
            <div className="px-3.5 pb-2.5 text-sm text-[color:var(--color-error)]" role="alert">{t('finder_failed')}</div>
          )}
          {typed.length >= 2 && status === 'idle' && results != null && results.length === 0 && (
            <div className="px-3.5 pb-2.5 text-sm text-text-muted" role="status">{t('finder_none', { query: typed })}</div>
          )}
          {props.multiple && (
            <div className="flex items-center justify-end gap-2 border-t border-border-light px-3 py-2">
              <Button variant="ghost" size="sm" onClick={() => close(true)}>{t('finder_cancel')}</Button>
              <Button
                variant="primary"
                size="sm"
                disabled={picked.length === 0}
                onClick={() => { props.onPickMany(picked); close(true); }}
              >
                {props.addManyLabel ? props.addManyLabel(picked.length) : t('finder_add_n', { count: picked.length })}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
