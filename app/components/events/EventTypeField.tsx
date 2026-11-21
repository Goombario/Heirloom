'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ChevronDown, Plus } from '@/lib/icons';
import { cx, fieldClass } from '@/app/components/ui';
import type { EventTypeCount } from '@/lib/events/custom-types';

/** One heading's worth of standard types ("Life": Birth, Adoption, …). */
export interface EventTypeGroup {
    key: string;
    label: string;
    types: readonly string[];
}

interface EventTypeFieldProps {
    id?: string;
    /** The chosen type: a GEDCOM tag, or a custom label as typed. Empty when none is chosen. */
    value: string;
    onChange: (type: string) => void;
    /** The standard types, in the phone's groups. */
    groups: readonly EventTypeGroup[];
    /** Custom labels already used in the tree, most used first. */
    used: readonly EventTypeCount[];
    /** A type's shown name: the translation for a tag, the label itself for a custom type. */
    labelOf: (type: string) => string;
    /** Id of a hint under the field, for `aria-describedby`. */
    describedBy?: string;
}

type Row =
    | { kind: 'type'; type: string; count?: number }
    | { kind: 'add'; name: string };

interface Section {
    key: string;
    label: string;
    rows: Row[];
    /** "No match" under Standard types while a search finds none. */
    empty?: boolean;
}

const PANEL = 'fixed z-[90] pointer-events-auto max-h-[320px] overflow-y-auto overscroll-contain p-1 bg-card border border-border rounded-[10px]';
const OPTION = 'flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-[7px] text-sm text-text cursor-pointer';
const PANEL_MAX = 320;

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

/** The label with the searched part in bold ("**Mil**itary service"). */
function Highlight({ text, query }: { text: string; query: string }) {
    const at = query ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
    if (at < 0) return <>{text}</>;
    return <>{text.slice(0, at)}<b className="font-semibold">{text.slice(at, at + query.length)}</b>{text.slice(at + query.length)}</>;
}

/**
 * The desktop event panel's Type field (#162, mockup option B): one search over the
 * standard types and the labels already used in the tree, with Add "…" as a new
 * event type at the end. It works like the phone's All event types sheet.
 *
 * Opened empty, it lists Used in this tree first (with event counts), then the
 * standard types under the phone's group headings. Typing filters both: Standard
 * types first, so "Grad" offers Graduation rather than a new label, then Used in
 * this tree, then the Add row unless the text already names a type. Enter picks the
 * highlighted row, and Escape closes without changing the type.
 */
export function EventTypeField({ id, value, onChange, groups, used, labelOf, describedBy }: EventTypeFieldProps) {
    const t = useTranslations('eventEdit');
    const tm = useTranslations('mobileEvents');
    const baseId = useId();
    const listId = `${baseId}-list`;
    const optionId = (i: number) => `${baseId}-opt-${i}`;
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(-1);
    const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const q = tidy(query);
    const sections = useMemo<Section[]>(() => {
        const lower = q.toLocaleLowerCase();
        const matches = (s: string) => s.toLocaleLowerCase().includes(lower);
        const usedRows: Row[] = used.filter((u) => !q || matches(u.type)).map((u) => ({ kind: 'type', type: u.type, count: u.count }));
        const usedSection: Section = { key: 'used', label: tm('group_used'), rows: usedRows };
        if (!q) {
            return [
                ...(usedRows.length ? [usedSection] : []),
                ...groups.map((g) => ({ key: g.key, label: g.label, rows: g.types.map((type): Row => ({ kind: 'type', type })) })),
            ];
        }
        const all = groups.flatMap((g) => g.types);
        const standard = all.filter((type) => matches(labelOf(type)));
        // A label that already names a type is picked, never added again.
        const known = all.some((type) => type.toLowerCase() === lower || labelOf(type).toLocaleLowerCase() === lower)
            || used.some((u) => u.type.toLocaleLowerCase() === lower);
        return [
            { key: 'standard', label: t('group_standard'), rows: standard.map((type): Row => ({ kind: 'type', type })), empty: standard.length === 0 },
            ...(usedRows.length ? [usedSection] : []),
            ...(known ? [] : [{ key: 'add', label: '', rows: [{ kind: 'add', name: q } as Row] }]),
        ];
    }, [q, used, groups, labelOf, t, tm]);
    const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

    const place = React.useCallback(() => {
        const r = inputRef.current?.getBoundingClientRect();
        if (!r) return;
        const below = window.innerHeight - r.bottom;
        setPos(below < PANEL_MAX + 8 && r.top > below
            ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 }
            : { left: r.left, width: r.width, top: r.bottom + 4 });
    }, []);

    function openList() {
        if (open) return;
        place();
        setQuery('');
        setActive(-1);
        setOpen(true);
    }

    function close() {
        setOpen(false);
        setQuery('');
        setActive(-1);
    }

    function choose(row: Row | undefined) {
        if (!row) return;
        const next = row.kind === 'add' ? row.name : row.type;
        close();
        if (next !== value) onChange(next);
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        const last = flat.length - 1;
        if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openList(); }
            return;
        }
        switch (e.key) {
            case 'ArrowDown': e.preventDefault(); setActive((a) => Math.min(last, a + 1)); return;
            case 'ArrowUp': e.preventDefault(); setActive((a) => Math.max(0, a - 1)); return;
            case 'Enter':
                e.preventDefault();
                choose(flat[active >= 0 ? active : q ? 0 : -1]);
                return;
            // Stop here so an enclosing modal's document-level Escape doesn't also close it.
            case 'Escape': e.preventDefault(); e.stopPropagation(); close(); return;
            case 'Tab': close(); return;
        }
    }

    // Keep the highlighted row in view as the keyboard walks the list.
    useEffect(() => {
        if (!open || active < 0) return;
        listRef.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView?.({ block: 'nearest' });
    }, [open, active]);

    useEffect(() => {
        if (!open) return;
        const onPointer = (e: PointerEvent) => {
            const target = e.target as Node;
            if (!listRef.current?.contains(target) && !inputRef.current?.contains(target)) close();
        };
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

    let index = 0;
    const renderRow = (row: Row) => {
        const i = index++;
        const isActive = i === active;
        const common = {
            id: optionId(i),
            role: 'option' as const,
            'aria-selected': row.kind === 'type' && row.type === value,
            'data-active': isActive || undefined,
            onClick: () => choose(row),
            onMouseMove: () => { if (active !== i) setActive(i); },
        };
        if (row.kind === 'add') {
            return (
                <div key="add" {...common} className={cx(OPTION, 'mt-1 border-t border-border rounded-t-none text-link', isActive && 'bg-[color:var(--color-hover-surface)]')}>
                    <span className="inline-flex items-center gap-1.5"><Plus size={14} aria-hidden />{tm('add_custom', { name: row.name })}</span>
                </div>
            );
        }
        return (
            <div key={`${row.count != null ? 'u' : 's'}-${row.type}`} {...common}
                className={cx(OPTION, isActive && 'bg-[color:var(--color-hover-surface)]', row.type === value && 'font-semibold')}>
                <span className="min-w-0 truncate"><Highlight text={labelOf(row.type)} query={q} /></span>
                {row.count != null && <span className="shrink-0 text-meta text-text-muted">{t('type_used_count', { count: row.count })}</span>}
            </div>
        );
    };

    const list = open && pos && typeof document !== 'undefined' ? createPortal(
        <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={inputRef.current?.labels?.[0]?.textContent ?? t('field_type')}
            // Keep focus in the input, where typing and the keyboard live.
            onMouseDown={(e) => e.preventDefault()}
            className={PANEL}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, boxShadow: 'var(--shadow-lg)' }}
        >
            {sections.map((s) => s.key === 'add'
                ? s.rows.map(renderRow)
                : (
                    <div key={s.key} role="group" aria-labelledby={`${baseId}-g-${s.key}`}>
                        <div id={`${baseId}-g-${s.key}`} role="presentation" className="eyebrow font-bold text-text-secondary px-2.5 pt-2 pb-1">{s.label}</div>
                        {s.empty && <div role="presentation" className="px-2.5 py-1.5 text-sm text-text-muted">{t('type_no_match')}</div>}
                        {s.rows.map(renderRow)}
                    </div>
                ))}
            {!q && <div role="presentation" className="mt-1 border-t border-border px-2.5 pt-2 pb-1 text-meta text-text-muted">{tm('not_listed')}</div>}
        </div>,
        document.body,
    ) : null;

    const shown = value ? labelOf(value) : '';
    return (
        <div className="relative">
            <input
                ref={inputRef}
                id={id}
                type="text"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
                aria-describedby={describedBy}
                autoComplete="off"
                maxLength={120}
                // The raw value, for scripts and tests that can't map a translated label back.
                data-value={value}
                value={open ? query : shown}
                placeholder={open && shown ? shown : tm('search_types')}
                onFocus={openList}
                onClick={openList}
                onChange={(e) => { if (!open) openList(); setQuery(e.target.value); setActive(e.target.value.trim() ? 0 : -1); }}
                onKeyDown={onKeyDown}
                onBlur={close}
                className={cx(fieldClass('sm'), 'pr-8')}
            />
            <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            {list}
        </div>
    );
}
