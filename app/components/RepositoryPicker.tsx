'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, IconButton, InlineDataError, cx, fieldClass } from '@/app/components/ui';
import { useCachedResource } from '@/app/components/useCachedResource';
import { useNoAutofill } from '@/app/hooks/useNoAutofill';
import { getDataClient } from '@/lib/data';
import type { RepositoryWithCount } from '@/lib/data/types';
import { Plus, Search, X } from '@/lib/icons';

const repositoriesListKey = (treeId: number | null) => `repositories:list:tree=${treeId ?? 'default'}`;

/** The tree's repository whose name matches `name` ignoring case and surrounding space. */
function findByName(repositories: RepositoryWithCount[], name: string): RepositoryWithCount | undefined {
    const key = name.trim().toLowerCase();
    return key ? repositories.find((r) => r.Name.trim().toLowerCase() === key) : undefined;
}

type PickerOption = { kind: 'auto' } | { kind: 'repo'; repo: RepositoryWithCount } | { kind: 'create' };

export interface RepositoryPickerProps {
    /** The source's repository name. Saving it still goes through `syncSourceRepository`'s find-or-create (#469). */
    value: string;
    onChange: (name: string) => void;
    treeId: number | null;
    label: string;
    id: string;
    disabled?: boolean;
    size?: 'sm' | 'md';
    /**
     * A record site's repository (#1029). Adds "Automatic · <name>" as the first
     * option: the tree's repository of that name, ignoring case, or a new one by
     * that name when the source is saved.
     */
    automatic?: string;
}

/**
 * Pick one of the tree's repositories, or name a new one (#469). Closed, it shows
 * the chosen repository and a Change button. Open, it searches the tree's
 * repositories by name, and "Create a new repository" is always the last option:
 * it takes the search text as the name when that text doesn't already name a
 * repository, and otherwise asks for one.
 */
export function RepositoryPicker({ value, onChange, treeId, label, id, disabled = false, size = 'md', automatic }: RepositoryPickerProps) {
    const t = useTranslations('library');
    const tCommon = useTranslations('common');
    const noAutofill = useNoAutofill();
    const labelId = `${id}-label`;
    const listboxId = useId();
    const optionId = (index: number) => `${listboxId}-opt-${index}`;

    const [openState, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(-1);
    const [naming, setNaming] = useState(false);
    const [newName, setNewName] = useState('');
    const searchRef = useRef<HTMLInputElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const changeRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const focusChange = useRef(false);

    const { data, loading, error, retry } = useCachedResource(
        repositoriesListKey(treeId),
        async () => {
            const client = await getDataClient();
            return await client.repositories.list(treeId);
        },
    );
    const repositories = useMemo(() => data ?? [], [data]);

    const trimmedQuery = query.trim();
    const matches = useMemo(() => {
        const q = trimmedQuery.toLowerCase();
        return q ? repositories.filter((r) => r.Name.toLowerCase().includes(q)) : repositories;
    }, [repositories, trimmedQuery]);
    // Create takes the search text as its name only when no repository has that name already.
    const freshName = trimmedQuery && !findByName(repositories, trimmedQuery) ? trimmedQuery : '';
    const automaticRepo = automatic ? findByName(repositories, automatic) : undefined;
    const options: PickerOption[] = [
        ...(automatic ? [{ kind: 'auto' as const }] : []),
        // Automatic already stands for the site's own repository.
        ...matches.filter((repo) => repo !== automaticRepo).map((repo) => ({ kind: 'repo' as const, repo })),
        { kind: 'create' },
    ];

    const current = value.trim() ? findByName(repositories, value) : undefined;
    const isAutomatic = !!automatic && value.trim().toLowerCase() === automatic.trim().toLowerCase();
    // A save in flight disables the form; the picker can't stay open to change it.
    const open = openState && !disabled;

    useEffect(() => {
        if (open && !naming) {
            searchRef.current?.focus();
            // The list opens in the document flow, so on a phone it can open below the fold (#796).
            listRef.current?.scrollIntoView?.({ block: 'nearest' });
        }
        else if (naming) nameRef.current?.focus();
        else if (focusChange.current) {
            focusChange.current = false;
            changeRef.current?.focus();
        }
    }, [open, naming]);

    function close() {
        setOpen(false);
        setNaming(false);
        setQuery('');
        setNewName('');
        setActiveIndex(-1);
        focusChange.current = true;
    }

    // A typed name that matches an existing repository ignoring case links that
    // repository rather than creating a near-duplicate.
    function commit(name: string) {
        const trimmed = name.trim();
        onChange(findByName(repositories, trimmed)?.Name ?? trimmed);
        close();
    }

    function choose(option: PickerOption) {
        if (option.kind === 'auto') commit(automatic!);
        else if (option.kind === 'repo') commit(option.repo.Name);
        else if (freshName) commit(freshName);
        else setNaming(true);
    }

    function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, -1));
        } else if (e.key === 'Enter') {
            // Never submit the surrounding form from the search.
            e.preventDefault();
            if (activeIndex >= 0 && options[activeIndex]) choose(options[activeIndex]);
            // Nothing highlighted: the repository the text names, or a new one by that name.
            else if (trimmedQuery) commit(trimmedQuery);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
        }
    }

    function handleNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (newName.trim()) commit(newName);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setNaming(false);
        }
    }

    function describe(option: PickerOption): { key: string | number; title: string; hint: string } {
        if (option.kind === 'auto') {
            return {
                key: 'auto',
                title: t('repo_picker_automatic', { name: automaticRepo?.Name ?? automatic!.trim() }),
                hint: automaticRepo ? t('repo_picker_in_tree', { count: automaticRepo.SourceCount }) : t('repo_picker_created_on_save'),
            };
        }
        if (option.kind === 'create') {
            return {
                key: 'create',
                title: freshName ? t('repo_picker_create_named', { name: freshName }) : t('repo_picker_create'),
                hint: freshName ? t('repo_picker_created_on_save') : t('repo_picker_name_it'),
            };
        }
        return { key: option.repo.Id, title: option.repo.Name, hint: t('repo_picker_in_tree', { count: option.repo.SourceCount }) };
    }

    const textSize = size === 'sm' ? 'text-sm' : 'text-base';

    return (
        <div role="group" aria-labelledby={labelId}>
            <span id={labelId} className="block text-sm font-medium text-text-secondary mb-1.5">{label}</span>
            {!open ? (
                <div className={cx('flex items-center gap-2 rounded-lg border border-border bg-card', size === 'sm' ? 'px-2.5 py-1' : 'px-3 py-1.5')}>
                    <span className="min-w-0 flex-1">
                        {value.trim() ? (
                            <>
                                <span className={cx('block truncate text-text', textSize)}>
                                    {isAutomatic
                                        ? t('repo_picker_automatic', { name: current?.Name ?? automatic!.trim() })
                                        : current ? current.Name : t('repo_picker_new_named', { name: value.trim() })}
                                </span>
                                <span className="block text-xs text-text-muted">
                                    {current ? t('repo_picker_in_tree', { count: current.SourceCount }) : t('repo_picker_created_on_save')}
                                </span>
                            </>
                        ) : (
                            <span className={cx('block text-text-muted', textSize)}>{t('repo_picker_none')}</span>
                        )}
                    </span>
                    {!disabled && (
                        <>
                            <Button
                                ref={changeRef}
                                id={id}
                                variant="ghost"
                                size="sm"
                                onClick={() => setOpen(true)}
                                aria-describedby={labelId}
                            >
                                {value.trim() ? tCommon('change') : t('repo_picker_choose')}
                            </Button>
                            {value.trim() && (
                                <IconButton
                                    size="sm"
                                    label={tCommon('remove_named', { name: value.trim() })}
                                    icon={<X className="w-3.5 h-3.5" aria-hidden="true" />}
                                    onClick={() => onChange('')}
                                />
                            )}
                        </>
                    )}
                </div>
            ) : naming ? (
                <div className="flex flex-col gap-2">
                    <label className="block">
                        <span className="block text-xs text-text-muted mb-1">{t('repo_picker_new_name_label')}</span>
                        <input
                            ref={nameRef}
                            id={id}
                            type="text"
                            className={fieldClass(size)}
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={handleNameKeyDown}
                            {...noAutofill('repository-name')}
                        />
                    </label>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setNaming(false)}>{tCommon('cancel')}</Button>
                        <Button variant="outline" size="sm" onClick={() => commit(newName)} disabled={!newName.trim()}>{tCommon('done')}</Button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    <div className="relative">
                        <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                        <input
                            ref={searchRef}
                            id={id}
                            type="text"
                            className={cx(fieldClass(size), 'pl-9')}
                            placeholder={t('repo_picker_search')}
                            aria-label={t('repo_picker_search')}
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); setActiveIndex(-1); }}
                            onKeyDown={handleSearchKeyDown}
                            role="combobox"
                            aria-autocomplete="list"
                            aria-expanded
                            aria-controls={listboxId}
                            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                            {...noAutofill('repository-search')}
                        />
                    </div>
                    {error ? (
                        <InlineDataError message={t('repo_picker_load_failed')} retryLabel={tCommon('retry')} onRetry={retry} />
                    ) : null}
                    <div ref={listRef} className="rounded-lg border border-border overflow-hidden">
                        <div id={listboxId} role="listbox" aria-label={label} className="max-h-56 overflow-y-auto divide-y divide-border">
                            {options.map((option, index) => {
                                const active = index === activeIndex;
                                const { key, title, hint } = describe(option);
                                return (
                                    <button
                                        key={key}
                                        id={optionId(index)}
                                        type="button"
                                        role="option"
                                        aria-selected={active}
                                        tabIndex={-1}
                                        className={cx('flex w-full items-start gap-2 px-3 py-2 text-left cursor-pointer focus:outline-none', active && 'bg-surface-2')}
                                        onMouseEnter={() => setActiveIndex(index)}
                                        onMouseDown={(e) => {
                                            // Fire before the search input's blur.
                                            e.preventDefault();
                                            choose(option);
                                        }}
                                        onClick={(e) => {
                                            // A screen reader's virtual click arrives with detail === 0.
                                            if (e.detail === 0) choose(option);
                                        }}
                                    >
                                        {option.kind === 'create' && <Plus className="w-4 h-4 mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />}
                                        <span className="min-w-0">
                                            <span className={cx('block text-text', textSize)}>{title}</span>
                                            <span className="block text-xs text-text-muted">{hint}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        {loading ? (
                            <p className="px-3 py-1.5 text-xs text-text-muted bg-card-alt" style={{ margin: 0 }}>{tCommon('loading')}</p>
                        ) : trimmedQuery && matches.length === 0 ? (
                            <p className="px-3 py-1.5 text-xs text-text-muted bg-card-alt" style={{ margin: 0 }}>{t('repo_picker_no_match')}</p>
                        ) : null}
                    </div>
                    <div className="flex justify-end">
                        <Button variant="ghost" size="sm" onClick={close}>{tCommon('cancel')}</Button>
                    </div>
                </div>
            )}
        </div>
    );
}
