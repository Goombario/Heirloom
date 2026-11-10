'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import type { Note } from '@/lib/data/types';
import type { LinkOwnerTable } from '@/lib/db/fact-tables';
import type { RunChange } from '@/app/people/view/mobile/useChange';
import { MobileRow } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { Trash2 } from '@/lib/icons';

/**
 * The phone note sheet for a record that isn't a person (a place, a source, a case):
 * the text, Save, and Delete as the last row with its confirm. The person page keeps
 * its own sheet, which also scopes a note to a fact and offers the biography.
 */
export function MobileNoteSheet({ note, open, onClose, ownerTable, ownerId, treeId, canDelete, run }: {
    /** The note to edit, or null to add one. */
    note: Note | null;
    open: boolean;
    onClose: () => void;
    ownerTable: LinkOwnerTable;
    ownerId: number;
    treeId: number | null;
    canDelete: boolean;
    run: RunChange;
}) {
    // A fresh body on every open, so a cancelled draft never comes back.
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) { setWasOpen(open); if (open) setOpened((n) => n + 1); }
    return <NoteBody key={opened} {...{ note, open, onClose, ownerTable, ownerId, treeId, canDelete, run }} />;
}

function NoteBody({ note, open, onClose, ownerTable, ownerId, treeId, canDelete, run }: Parameters<typeof MobileNoteSheet>[0]) {
    const t = useTranslations('mobileProfile');
    const tn = useTranslations('notes');
    const ids = useId();
    const [text, setText] = useState(note?.Text ?? '');
    const [saving, setSaving] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const dirty = text.trim() !== (note?.Text ?? '').trim();

    const save = async () => {
        const body = text.trim();
        if (!body || saving) return;
        setSaving(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            return note
                ? client.notes.update(note.Id, ownerTable, ownerId, body, treeId)
                : client.notes.create(ownerTable, ownerId, body, treeId);
        }, { message: note ? t('note_saved') : t('note_added') });
        setSaving(false);
        if (ok) onClose();
    };

    const remove = async () => {
        if (!note) return;
        setSaving(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            return client.notes.remove(note.Id, ownerTable, ownerId, treeId);
        }, { message: t('note_deleted') });
        setSaving(false);
        setConfirming(false);
        if (ok) onClose();
    };

    return (
        <Sheet open={open} onClose={onClose} title={note ? t('note') : t('new_note')} size="full" dirty={dirty} onSave={save}
            saveDisabled={saving || !text.trim()} discardMessage={note ? undefined : t('note_discard')}>
            <label htmlFor={`${ids}-note`} className="sr-only">{t('note')}</label>
            <textarea
                id={`${ids}-note`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={20000}
                placeholder={t('note_placeholder')}
                className="block w-full min-h-[150px] py-3.5 bg-transparent border-0 resize-none text-md leading-relaxed text-text outline-none placeholder:text-text-muted input-nozoom"
            />
            {note && canDelete && (
                <div className="-mx-4 border-t border-border mt-2">
                    <MobileRow icon={<Trash2 />} tone="danger" label={t('delete_note')} onClick={() => setConfirming(true)} />
                </div>
            )}
            {note && (
                <ConfirmSheet open={confirming} title={t('delete_note_title')} body={tn('delete_blurb')}
                    confirmLabel={t('delete_note')} onConfirm={remove} onClose={() => setConfirming(false)} busy={saving} />
            )}
        </Sheet>
    );
}
