'use client';

import { useState } from 'react';
import { Bookmark, Trash2 } from '@/lib/icons';
import { Button, FormDialog, IconButton, Input, Select, showErrorToast, showSuccessToast } from '@/app/components/ui';
import type { SavedSearch } from '@/lib/services/advanced-search';
import { useSearchWords } from './useSearchWords';

type SavedChoice = { kind: 'open'; saved: SavedSearch } | { kind: 'copy' } | { kind: 'manage' };

/**
 * The Saved menu (#247, S1): the member's own saved searches with how many each
 * matches now, then "Copy link to this search" and "Manage saved searches".
 */
export function SavedSearchesMenu({ saved, current, canCopy, onOpen, onCopy, onManage }: {
    saved: SavedSearch[];
    /** The saved search the list shows now, if any. */
    current: number | null;
    canCopy: boolean;
    onOpen: (s: SavedSearch) => void;
    onCopy: () => void;
    onManage: () => void;
}) {
    const { t } = useSearchWords();
    const heading = t('saved_heading');
    const options = [
        ...saved.map((s) => ({ key: `s${s.id}`, value: { kind: 'open', saved: s } as SavedChoice, label: s.name, meta: s.count, group: heading })),
        ...(canCopy ? [{ key: 'copy', value: { kind: 'copy' } as SavedChoice, label: <span className="text-link">{t('copy_link')}</span> }] : []),
        ...(saved.length > 0 ? [{ key: 'manage', value: { kind: 'manage' } as SavedChoice, label: <span className="text-link">{t('manage')}</span> }] : []),
    ];
    return (
        <Select<SavedChoice>
            label=""
            ariaLabel={t('saved')}
            valueLabel={t('saved')}
            icon={<Bookmark className="w-3.5 h-3.5" aria-hidden="true" />}
            triggerClassName="h-9 text-sm"
            optionClassName="whitespace-nowrap"
            options={options}
            footer={saved.length === 0 ? t('saved_none') : undefined}
            isSelected={(v) => v.kind === 'open' && v.saved.id === current}
            onSelect={(v) => (v.kind === 'open' ? onOpen(v.saved) : v.kind === 'copy' ? onCopy() : onManage())}
        />
    );
}

/** Saving asks only for a name (#247 lock). */
export function SaveSearchDialog({ open, onClose, sentence, onSave }: {
    open: boolean;
    onClose: () => void;
    sentence: string;
    onSave: (name: string) => Promise<void>;
}) {
    const { t } = useSearchWords();
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    async function submit() {
        if (!name.trim() || busy) return;
        setBusy(true);
        try {
            await onSave(name.trim());
            setName('');
            onClose();
        } catch (e) {
            showErrorToast(e instanceof Error ? e.message : String(t('save_failed')));
        } finally {
            setBusy(false);
        }
    }
    return (
        <FormDialog
            open={open}
            onClose={onClose}
            title={t('save_title')}
            subtitle={sentence}
            busy={busy}
            footer={(close) => (
                <>
                    <Button variant="ghost" size="md" onClick={close}>{t('cancel')}</Button>
                    <Button variant="primary" size="md" disabled={!name.trim() || busy} onClick={submit}>{t('save_button')}</Button>
                </>
            )}
        >
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                <Input label={t('name_label')} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                <p className="mt-2 text-meta text-text-muted">{t('save_note')}</p>
            </form>
        </FormDialog>
    );
}

/** Manage saved searches: each one's name and count, and Delete. */
export function ManageSavedDialog({ open, onClose, saved, onDelete }: {
    open: boolean;
    onClose: () => void;
    saved: SavedSearch[];
    onDelete: (s: SavedSearch) => Promise<void>;
}) {
    const { t } = useSearchWords();
    return (
        <FormDialog
            open={open}
            onClose={onClose}
            title={t('manage_title')}
            footer={(close) => <Button variant="outline" size="md" onClick={close}>{t('done')}</Button>}
        >
            {saved.length === 0 ? (
                <p className="text-sm text-text-muted">{t('saved_none')}</p>
            ) : (
                <ul className="border border-border rounded-[10px]">
                    {saved.map((s) => (
                        <li key={s.id} className="flex items-center gap-2.5 px-3 py-2 text-sm border-t border-border first:border-t-0">
                            <span className="flex-1 min-w-0 truncate">{s.name}</span>
                            <span className="text-text-muted whitespace-nowrap">{t('people_count', { count: s.count })}</span>
                            <IconButton
                                label={t('delete_named', { name: s.name })}
                                size="sm"
                                icon={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                                onClick={async () => {
                                    try { await onDelete(s); showSuccessToast(String(t('deleted_toast'))); } catch (e) { showErrorToast(e instanceof Error ? e.message : String(e)); }
                                }}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </FormDialog>
    );
}
