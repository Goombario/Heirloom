'use client';

import React, { useState, useEffect, useRef, useCallback, forwardRef, useId, useImperativeHandle } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { PersonResult } from '@/lib/db/schema';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import PersonAvatar from '@/app/components/PersonAvatar';
import { Button, fieldClass, Lifespan, PersonIdentity } from '@/app/components/ui';
import { prefetchPerson } from '@/app/people/view/personCache';
import { getDataClient } from '@/lib/data';
import { UnauthorizedError } from '@/lib/data/errors';
import { Search, X } from '@/lib/icons';
import { useNoAutofill } from '@/app/hooks/useNoAutofill';
import { personKin } from '@/lib/utils/person-kin';

export type PersonPickerHandle = {
    focus: () => void;
};

type PersonPickerBaseProps = {
    showSex?: boolean;
    showDates?: boolean;
    excludeIds?: number[];
    treeId?: number | null;
    placeholder?: string;
    disabled?: boolean;
    linkPersons?: boolean;
    /** Render results inline (document flow) instead of as an absolute dropdown */
    inline?: boolean;
    /** Override the inline results container height/scroll classes (default `max-h-48 overflow-y-auto`).
     *  Pass '' to let results flow and have an ancestor own the scroll (e.g. the face-tag sheet). */
    inlineResultsClassName?: string;
};

type SinglePickerProps = PersonPickerBaseProps & {
    multiple?: false;
    value: PersonResult | null;
    onChange: (p: PersonResult | null) => void;
    /** The picked chip offers "Change" instead of "Remove" (a slot that is swapped,
     *  not emptied, such as a partner in the family hero editor). Both clear the
     *  value and focus the search. */
    changeable?: boolean;
};

type MultiPickerProps = PersonPickerBaseProps & {
    multiple: true;
    value: PersonResult[];
    onChange: (p: PersonResult[]) => void;
};

type PersonPickerProps = SinglePickerProps | MultiPickerProps;

function formatMeta(
    result: PersonResult,
    showSex: boolean,
    showDates: boolean,
    sexLabel: (sex: string | null | undefined) => string,
): { sex: string | null; dates: React.ReactNode } {
    let sex: string | null = null;
    if (showSex) sex = sexLabel(result.Sex);

    let dates: React.ReactNode = null;
    if (showDates && (result.BirthDate || result.DeathDate)) {
        dates = <Lifespan birth={result.BirthDate} death={result.DeathDate} />;
    }
    return { sex, dates };
}

/** Thin adapter onto the shared `PersonAvatar` (photo-or-initials disc). Kept
 *  local only to map the picker's `PersonResult` + `sm`/`md` size onto the
 *  shared component's props; `as="span"` is passed when the disc sits inside a
 *  `<button>` (the result rows). */
function PickerAvatar({
    person,
    size,
    treeId,
    as,
}: {
    person: PersonResult;
    size: 'sm' | 'md';
    treeId?: number | null;
    as?: 'div' | 'span';
}) {
    const tc = useTranslations('common');
    return (
        <PersonAvatar
            as={as}
            mediaId={person.PrimaryMediaId}
            treeId={treeId}
            name={displayFullName(person) || tc('unknown')}
            initials={getInitials(person.FirstName, person.LastName)}
            sex={person.Sex}
            size={size === 'sm' ? 24 : 34}
            focalX={person.FocalX}
            focalY={person.FocalY}
            focalRadius={person.FocalRadius}
        />
    );
}

/**
 * One option of the picker's listbox. Focus stays in the search input, which
 * points at the active option with `aria-activedescendant`; the active option
 * is highlighted, and it is what Enter picks (#793). The mouse moves the same
 * highlight, so hover and keyboard never show two rows.
 */
function ResultRow({ id, person, active, showSex, showDates, onClick, onHover, treeId, sexLabel }: {
    id: string;
    person: PersonResult;
    active: boolean;
    showSex: boolean;
    showDates: boolean;
    onClick: () => void;
    onHover: () => void;
    treeId?: number | null;
    sexLabel: (sex: string | null | undefined) => string;
}) {
    const tc = useTranslations('common');
    const { sex, dates } = formatMeta(person, showSex, showDates, sexLabel);
    const name = displayFullName(person) || `(${tc('unknown')})`;
    const kin = personKin(person);

    return (
        <button
            id={id}
            type="button"
            role="option"
            aria-selected={active}
            tabIndex={-1}
            // The documented neutral selected row, as in global search (CL-1, #749).
            className={`flex items-center gap-3 px-3 py-2 cursor-pointer focus:outline-none w-full text-left ${active ? 'bg-surface-2' : ''}`}
            onMouseEnter={() => { onHover(); prefetchPerson(person.Id, treeId); }}
            onMouseDown={(e) => {
                // Use mousedown to fire before the input's blur event
                e.preventDefault();
                onClick();
            }}
            onClick={(e) => {
                // A screen reader's virtual click arrives with detail === 0.
                if (e.detail === 0) onClick();
            }}
        >
            {/* Identity markup lives in the shared `PersonIdentity` primitive so the
                faces queue's ambiguity chips render an identical row. `as="span"`
                because every wrapper here sits inside this <button>. */}
            <PersonIdentity
                as="span"
                name={name}
                initials={getInitials(person.FirstName, person.LastName)}
                sex={person.Sex}
                mediaId={person.PrimaryMediaId}
                focalX={person.FocalX}
                focalY={person.FocalY}
                focalRadius={person.FocalRadius}
                treeId={treeId}
                meta={sex}
                lifespan={dates}
                detail={kin ? tc(kin.kind === 'child' ? 'child_of' : 'partner_of', { names: kin.names }) : null}
            />
        </button>
    );
}

const PersonPicker = forwardRef<PersonPickerHandle, PersonPickerProps>(function PersonPicker(props, ref) {
    // Chrome's saved-address autofill covers this picker's own results (#442).
    const noAutofill = useNoAutofill();
    const tCommon = useTranslations('common');

    const sexLabel = (sex: string | null | undefined) =>
        sex === 'M' ? tCommon('male') : sex === 'F' ? tCommon('female') : tCommon('unknown_sex');

    const {
        showSex = false,
        showDates = false,
        excludeIds = [],
        treeId,
        placeholder = tCommon('search_for_person'),
        disabled = false,
        linkPersons = false,
        inline = false,
        inlineResultsClassName,
    } = props;

    const [searchText, setSearchText] = useState('');
    const [results, setResults] = useState<PersonResult[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [openUpward, setOpenUpward] = useState(false);
    // The highlighted option, or -1 for none. Enter picks it; with none, Enter
    // does nothing, so it can never pick a row the user can't see is chosen (#793).
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const listboxRef = useRef<HTMLDivElement>(null);
    const listboxId = useId();
    const optionId = (index: number) => `${listboxId}-option-${index}`;

    useImperativeHandle(ref, () => ({
        focus: () => inputRef.current?.focus(),
    }));

    // Stable dependency: serialized selected IDs and excludeIds for memo invalidation
    const selectedIds = props.multiple
        ? props.value.map((p) => p.Id).join(',')
        : props.value?.Id ?? '';
    const excludeIdsKey = JSON.stringify(excludeIds ?? []);

    // Build the full set of IDs to exclude (explicit + already selected in multi mode)
    const allExcludeIds = useCallback(() => {
        const ids = new Set(excludeIds);
        if (props.multiple) {
            for (const p of props.value) {
                ids.add(p.Id);
            }
        } else if (props.value) {
            ids.add(props.value.Id);
        }
        return ids;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [excludeIdsKey, selectedIds]);

    // Debounced search; the 300ms debounce + min-length guard suppress stale in-flight results
    useEffect(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        if (searchText.length < 2) {
            setResults([]);
            setIsOpen(false);
            setError(null);
            return;
        }

        debounceRef.current = setTimeout(async () => {
            try {
                const client = await getDataClient();
                const people = await client.people.search(searchText, treeId, 10);
                setError(null);
                const excluded = allExcludeIds();
                const filtered = (people as PersonResult[]).filter((p) => !excluded.has(p.Id));
                setResults(filtered);
                setActiveIndex(-1);
                setIsOpen(filtered.length > 0);
            } catch (err) {
                // Preserve the picker's inline error UX (no full-page redirect): an
                // embedded picker shouldn't navigate away mid-form on a 401.
                setError(err instanceof UnauthorizedError ? 'Session expired' : 'Search failed');
                setResults([]);
                setIsOpen(false);
            }
        }, 300);

        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [searchText, treeId, allExcludeIds]);

    // Click-outside handler
    useEffect(() => {
        function handleMouseDown(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleMouseDown);
        return () => document.removeEventListener('mousedown', handleMouseDown);
    }, []);

    // Detect whether dropdown should open upward (only for absolute/non-inline mode)
    useEffect(() => {
        if (isOpen && !inline && inputRef.current) {
            const rect = inputRef.current.getBoundingClientRect();
            setOpenUpward(window.innerHeight - rect.bottom < 280);
        }
    }, [isOpen, inline]);

    const listOpen = isOpen && results.length > 0;

    // Inline results open in the document flow, so on a long page they can open
    // below the fold (#796, ED-8). Bring them into view when they first appear.
    useEffect(() => {
        if (inline && listOpen) listboxRef.current?.scrollIntoView?.({ block: 'nearest' });
    }, [inline, listOpen]);

    // Keep the highlighted option in view when the arrows move past the fold.
    useEffect(() => {
        if (activeIndex < 0) return;
        listboxRef.current?.children[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
    }, [activeIndex]);

    function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'ArrowDown' && results.length > 0) {
            e.preventDefault();
            if (!isOpen) setIsOpen(true);
            setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        } else if (e.key === 'ArrowUp' && listOpen) {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, -1));
        } else if (e.key === 'Enter' && listOpen) {
            // Never submit a surrounding form while the list is showing.
            e.preventDefault();
            if (activeIndex >= 0 && results[activeIndex]) handleSelect(results[activeIndex]);
        } else if (e.key === 'Escape') {
            setIsOpen(false);
            setActiveIndex(-1);
        }
    }

    function handleSelect(person: PersonResult) {
        if (props.multiple) {
            props.onChange([...props.value, person]);
        } else {
            props.onChange(person);
        }
        setSearchText('');
        setResults([]);
        setActiveIndex(-1);
        setIsOpen(false);

        // Keep focus for multi-select
        if (props.multiple) {
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }

    function handleRemoveSingle() {
        if (!props.multiple) {
            props.onChange(null);
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }

    function handleRemoveMulti(id: number) {
        if (props.multiple) {
            props.onChange(props.value.filter((p) => p.Id !== id));
        }
    }

    if (!props.multiple && props.value) {
        const person = props.value;
        const name = displayFullName(person) || `(${tCommon('unknown')})`;

        return (
            <div ref={containerRef} className="flex items-center gap-3 border border-border rounded-lg px-3 py-2">
                <PickerAvatar person={person} size="md" treeId={treeId} />
                <span className="text-base font-semibold text-text flex-1 truncate">{name}</span>
                {!disabled && (props.changeable ? (
                    <Button variant="ghost" size="sm" onClick={handleRemoveSingle} aria-label={tCommon('change_named', { name })}>
                        {tCommon('change')}
                    </Button>
                ) : (
                    <Button variant="outline" size="sm" className="text-xs" onClick={handleRemoveSingle}>
                        {tCommon('remove')}
                    </Button>
                ))}
            </div>
        );
    }

    return (
        <div ref={containerRef}>
            {props.multiple && props.value.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                    {props.value.map((person) => {
                        const name = displayFullName(person) || `(${tCommon('unknown')})`;
                        const pillContent = (
                            <>
                                <PickerAvatar person={person} size="sm" treeId={treeId} />
                                <span className="text-sm font-semibold text-text">{name}</span>
                                {!disabled && (
                                    <button
                                        type="button"
                                        className="text-text-muted hover:text-text ml-0.5"
                                        onClick={(e) => { e.preventDefault(); handleRemoveMulti(person.Id); }}
                                        aria-label={tCommon('remove_named', { name })}
                                    >
                                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                                    </button>
                                )}
                            </>
                        );
                        const pillClass = "inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-hover-surface)] px-2.5 py-1";
                        return linkPersons ? (
                            <Link
                                key={person.Id}
                                href={`/people/view?id=${person.Id}`}
                                className={`${pillClass} hover:bg-(--color-surface-2) transition-colors`}
                                onMouseEnter={() => prefetchPerson(person.Id, treeId)}
                                onFocus={() => prefetchPerson(person.Id, treeId)}
                            >
                                {pillContent}
                            </Link>
                        ) : (
                            <div key={person.Id} className={pillClass}>
                                {pillContent}
                            </div>
                        );
                    })}
                </div>
            )}

            {!disabled && (
                <div className={inline ? undefined : 'relative'}>
                    <div className="relative">
                        <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                        <input
                            ref={inputRef}
                            type="text"
                            className={fieldClass()}
                            style={{ paddingLeft: '2.5rem' }}
                            placeholder={placeholder}
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            {...noAutofill('person-search')}
                            onFocus={() => {
                                if (results.length > 0) setIsOpen(true);
                            }}
                            onKeyDown={handleInputKeyDown}
                            role="combobox"
                            aria-autocomplete="list"
                            aria-expanded={listOpen}
                            aria-controls={listOpen ? listboxId : undefined}
                            aria-activedescendant={listOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
                        />
                    </div>

                    {error && (
                        <div className="text-sm text-error mt-1">{error}</div>
                    )}

                    {listOpen && (
                        <div
                            className={inline
                                // overflow-hidden: the bg-card-alt footer row paints to the
                                // square bounds, and callers may pass an inlineResultsClassName
                                // with no scroll container of its own (WhoIsThisModal passes '').
                                ? `mt-2 border border-border rounded-lg overflow-hidden divide-y divide-border ${inlineResultsClassName ?? 'max-h-48 overflow-y-auto'}`
                                : `absolute z-50 w-full bg-card rounded-lg shadow-lg border border-border max-h-64 overflow-y-auto ${openUpward ? 'bottom-full mb-1' : 'top-full mt-1'}`
                            }
                        >
                            <div ref={listboxRef} id={listboxId} role="listbox" aria-label={placeholder} className="divide-y divide-border">
                                {results.map((person, index) => (
                                    <ResultRow
                                        key={person.Id}
                                        id={optionId(index)}
                                        person={person}
                                        active={index === activeIndex}
                                        showSex={showSex}
                                        showDates={showDates}
                                        onClick={() => handleSelect(person)}
                                        onHover={() => setActiveIndex(index)}
                                        treeId={treeId}
                                        sexLabel={sexLabel}
                                    />
                                ))}
                            </div>
                            <div className="px-3 py-1.5 bg-card-alt flex justify-between text-xs text-text-muted tabular-nums">
                                <span>{tCommon('picker_nav_hint')}</span>
                                <span>{tCommon('picker_match_count', { count: results.length })}</span>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});
PersonPicker.displayName = 'PersonPicker';
export default PersonPicker;
