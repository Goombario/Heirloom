'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import type { RepositoryWithCount, Source } from '@/lib/data/types';
import { useTree } from '@/app/contexts/TreeContext';
import { useErrorToast } from '@/app/components/useErrorToast';
import { emptySourceForm, type SourceFormState } from '@/app/components/SourceFields';
import { MobileListChip, MobileRow, RadioRow, cx, showChangeToast } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { Landmark, Plus, Search, Trash2 } from '@/lib/icons';
import { foldForSearch } from '@/lib/utils/search-fold';
import { SOURCE_TYPES, sourceTypeLabel } from '../sourceTypes';
import { sourceFormPayload, sourceToForm } from '../useSourceEditor';

/**
 * The phone source sheet (#1119 Edit, #1127 New): a full-height typing sheet with
 * Cancel, the title and Save (dim until there is a title). Type is a row of chips;
 * the fields follow in a fixed order, every one but Title marked optional, Short title
 * and Publication always shown. Repository is a picker row that can create a new one,
 * made when the source is saved. Every type has the same fields (#470), the teller of
 * an oral source being its author. Editing ends with a red Delete row.
 */
export function SourceFormSheet(props: {
    open: boolean;
    /** The source to edit, or null for a new one. */
    source: Source | null;
    /** A new source's repository, already picked (Add a source here). */
    initialRepository?: string;
    onClose: () => void;
    onSaved: (source: Source) => void;
    /** Shows the Delete row (editors). */
    canDelete?: boolean;
    /** How many facts cite it, for the delete confirm. */
    citationCount?: number;
    onDeleted?: () => void;
}) {
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(props.open);
    if (props.open !== wasOpen) { setWasOpen(props.open); if (props.open) setOpened((n) => n + 1); }
    return <Body key={opened} {...props} />;
}

function Body({ open, source, initialRepository, onClose, onSaved, canDelete = false, citationCount = 0, onDeleted }: Parameters<typeof SourceFormSheet>[0]) {
    const t = useTranslations('library');
    const tm = useTranslations('mobileLibrary');
    const { activeTreeId } = useTree();
    const { reportError } = useErrorToast();
    const ids = useId();
    const start = useMemo<SourceFormState>(
        () => (source ? sourceToForm(source) : { ...emptySourceForm, RepositoryName: initialRepository ?? '' }),
        [source, initialRepository],
    );
    const [form, setFormState] = useState<SourceFormState>(start);
    const set = (patch: Partial<SourceFormState>) => setFormState((f) => ({ ...f, ...patch }));
    const [busy, setBusy] = useState(false);
    const [picking, setPicking] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const dirty = JSON.stringify(form) !== JSON.stringify(start);

    const save = async () => {
        if (!form.Title.trim() || busy) return;
        setBusy(true);
        try {
            const client = await getDataClient();
            const payload = sourceFormPayload(form);
            const saved = source
                ? await client.sources.update(source.Id, payload, activeTreeId)
                : await client.sources.create(payload, activeTreeId);
            showChangeToast({ message: source ? tm('source_saved') : tm('source_added') });
            onSaved(saved);
        } catch (e) {
            reportError(e);
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!source) return;
        setBusy(true);
        try {
            const client = await getDataClient();
            await client.sources.remove(source.Id, activeTreeId);
            showChangeToast({ message: tm('source_deleted'), detail: source.Title ?? undefined });
            setConfirming(false);
            onDeleted?.();
        } catch (e) {
            reportError(e);
        } finally {
            setBusy(false);
        }
    };

    const field = 'w-full min-h-11 rounded-[10px] border border-border bg-surface px-3 text-md text-text placeholder:text-text-muted input-nozoom focus-ring';
    const label = (text: string, optional = true) => (
        <span className="text-meta font-semibold text-text-secondary">
            {text}{optional && <span className="font-normal text-text-muted"> · {tm('optional')}</span>}
        </span>
    );
    const input = (key: keyof SourceFormState, text: string, extra?: { mono?: boolean; type?: string; hint?: string; placeholder?: string }) => (
        <label className="grid gap-1.5" htmlFor={`${ids}-${key}`}>
            {label(text)}
            <input id={`${ids}-${key}`} type={extra?.type ?? 'text'} value={form[key]} onChange={(e) => set({ [key]: e.target.value })}
                autoComplete="off" placeholder={extra?.placeholder} className={cx(field, extra?.mono && 'font-mono')} />
            {extra?.hint && <span className="text-meta text-text-muted">{extra.hint}</span>}
        </label>
    );

    return (
        <Sheet open={open} onClose={onClose} title={source ? tm('edit_source') : tm('new_source')} size="full"
            dirty={dirty} onSave={save} saveDisabled={busy || !form.Title.trim()} saveWhenClean={false}>
            <div className="grid gap-4 pt-1">
                <div className="grid gap-1.5">
                    <span id={`${ids}-type`} className="text-meta font-semibold text-text-secondary">{t('field_type')}</span>
                    <div role="group" aria-labelledby={`${ids}-type`} className="flex flex-wrap gap-x-1.5 gap-y-2.5">
                        {SOURCE_TYPES.map((type) => (
                            <MobileListChip key={type} active={form.Type === type}
                                label={sourceTypeLabel(type, t)} onClick={() => set({ Type: type })} />
                        ))}
                    </div>
                </div>
                <label className="grid gap-1.5" htmlFor={`${ids}-title`}>
                    {label(t('field_title_label'), false)}
                    <input id={`${ids}-title`} value={form.Title} onChange={(e) => set({ Title: e.target.value })} autoComplete="off"
                        placeholder={t('ph_title')} className={field} aria-required="true" />
                    <span className="text-meta text-text-muted">{tm('title_hint')}</span>
                </label>
                {input('Author', t('field_author'), { hint: t('hint_author') })}
                <div className="grid gap-1.5">
                    {label(t('field_repository'))}
                    <div className="-mx-4 border-y border-border">
                        <MobileRow icon={<Landmark />} end="chevron"
                            label={form.RepositoryName || tm('choose_repository')}
                            sub={form.RepositoryName ? tm('change_or_clear') : tm('where_kept')}
                            onClick={() => setPicking(true)} />
                    </div>
                </div>
                {input('CallNumber', tm('call_number'), { mono: true })}
                {input('Text', t('field_url'), { type: 'url', placeholder: 'https://', hint: t('hint_url') })}
                <label className="grid gap-1.5" htmlFor={`${ids}-contents`}>
                    {label(t('field_contents_label'))}
                    <textarea id={`${ids}-contents`} rows={6} value={form.Contents} onChange={(e) => set({ Contents: e.target.value })}
                        placeholder={t('ph_contents')} className={cx(field, 'py-2.5 leading-normal resize-none')} />
                </label>
                {input('Abbreviation', t('field_abbreviation'))}
                {input('PublicationInfo', tm('publication'))}
                {!source && <p className="m-0 text-meta leading-snug text-text-muted">{tm('after_save_hint')}</p>}
            </div>
            {source && canDelete && (
                <div className="-mx-4 mt-6 border-t border-border">
                    <MobileRow icon={<Trash2 />} tone="danger" label={t('delete_source')} onClick={() => setConfirming(true)} />
                </div>
            )}
            {source && (
                <ConfirmSheet open={confirming} title={t('delete_source_q')}
                    body={citationCount > 0 ? tm('delete_source_body', { count: citationCount, title: source.Title ?? '' }) : tm('delete_source_body_none', { title: source.Title ?? '' })}
                    confirmLabel={t('delete_source')} onConfirm={remove} onClose={() => setConfirming(false)} busy={busy} />
            )}
            <RepositoryPickerSheet open={picking} value={form.RepositoryName} onClose={() => setPicking(false)}
                onPick={(name) => { set({ RepositoryName: name }); setPicking(false); }} />
        </Sheet>
    );
}

/** The repository picker: search, a "Create '…'" row (made when the source is saved), the list. */
function RepositoryPickerSheet({ open, value, onClose, onPick }: { open: boolean; value: string; onClose: () => void; onPick: (name: string) => void }) {
    const t = useTranslations('library');
    const tm = useTranslations('mobileLibrary');
    const { activeTreeId } = useTree();
    const [repos, setRepos] = useState<RepositoryWithCount[]>([]);
    const [query, setQuery] = useState('');
    useEffect(() => {
        if (!open) return;
        let live = true;
        getDataClient().then((c) => c.repositories.list(activeTreeId)).then((r) => { if (live) setRepos(r); }).catch(() => {});
        return () => { live = false; };
    }, [open, activeTreeId]);
    const typed = query.trim();
    const q = foldForSearch(typed);
    const shown = repos.filter((r) => !q || foldForSearch(r.Name).includes(q));
    const exact = repos.some((r) => foldForSearch(r.Name) === q);
    return (
        <Sheet open={open} onClose={() => { setQuery(''); onClose(); }} title={t('field_repository')} size="full">
            <div className="relative">
                <Search className="absolute left-[13px] top-[13px] w-[18px] h-[18px] text-text-muted pointer-events-none" aria-hidden="true" />
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tm('find_repository')} aria-label={tm('find_repository')}
                    autoComplete="off" className="w-full h-11 rounded-full border border-border bg-surface pl-10 pr-4 text-md text-text placeholder:text-text-muted input-nozoom focus-ring" />
            </div>
            <div className="-mx-4 mt-2" role="radiogroup" aria-label={t('field_repository')}>
                {typed && !exact && (
                    <MobileRow icon={<Plus />} label={tm('create_named', { name: typed })} sub={tm('made_on_save')} onClick={() => { setQuery(''); onPick(typed); }} />
                )}
                {!typed && <RadioRow checked={!value} label={tm('no_repository_choice')} divided={false} onSelect={() => onPick('')} />}
                {shown.map((r) => (
                    <RadioRow key={r.Id} divided checked={r.Name === value}
                        label={r.Name} hint={r.Address ?? undefined} onSelect={() => { setQuery(''); onPick(r.Name); }} />
                ))}
            </div>
        </Sheet>
    );
}
