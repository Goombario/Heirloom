'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import { loadOwnerNotes } from '@/app/components/notes/ownerNotesCache';
import type { Note } from '@/lib/data/types';
import { AddRow, Card, InlinePanel, SectionHeader, cx, fieldClass } from '@/app/components/ui';
import type { RunChange } from '@/app/people/view/mobile/useChange';

const excerpt = (text: string) => (text.length > 40 ? `${text.slice(0, 40)}…` : text);

/**
 * The desktop place page's Notes (#56), in the main column: every note on the
 * place. Clicking a note opens it for editing in place; a save or delete goes
 * through `run`, which reloads the page (bumping `refreshKey`) and offers Undo
 * (editors only).
 */
export function PlaceNotes({ placeId, treeId, canEdit, canDelete, run, refreshKey }: {
    placeId: number;
    treeId: number | null;
    canEdit: boolean;
    canDelete: boolean;
    run: RunChange;
    /** Bumped after every write and Undo, so the list re-reads. */
    refreshKey: number;
}) {
    const t = useTranslations('placeDesktop');
    const tn = useTranslations('notes');
    const ids = useId();
    const [notes, setNotes] = useState<Note[] | null>(null);
    const [open, setOpen] = useState<number | 'new' | null>(null);
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let live = true;
        (async () => {
            try {
                const rows = await loadOwnerNotes('Places', placeId, treeId);
                if (live) setNotes(rows);
            } catch {
                if (live) setNotes([]);
            }
        })();
        return () => { live = false; };
    }, [placeId, treeId, refreshKey]);

    const list = notes ?? [];
    const editing = typeof open === 'number' ? list.find((n) => n.Id === open) ?? null : null;
    const dirty = editing ? text.trim() !== editing.Text.trim() : text.trim() !== '';

    const close = () => {
        const was = open;
        setOpen(null);
        requestAnimationFrame(() => {
            const row = typeof was === 'number' ? wrap.current?.querySelector<HTMLElement>(`[data-note-row="${was}"]`) : null;
            (row ?? wrap.current?.querySelector<HTMLElement>('[data-note-add]'))?.focus();
        });
    };
    const start = (note: Note | null) => {
        setText(note?.Text ?? '');
        setOpen(note ? note.Id : 'new');
    };

    const write = (fn: () => Promise<{ auditIds: number[] }>, message: string) => run(fn, { message });

    const save = async () => {
        const body = text.trim();
        if (saving || !body) return;
        if (!dirty) { close(); return; }
        setSaving(true);
        const ok = await write(async () => {
            const client = await getDataClient();
            if (!editing) return { auditIds: (await client.notes.create('Places', placeId, body, treeId)).auditIds };
            return client.notes.update(editing.Id, 'Places', placeId, body, treeId);
        }, editing ? t('note_saved') : t('note_added'));
        setSaving(false);
        if (ok) close();
    };

    const remove = async () => {
        if (!editing) return;
        setSaving(true);
        const ok = await write(async () => {
            const client = await getDataClient();
            return client.notes.remove(editing.Id, 'Places', placeId, treeId);
        }, t('note_deleted'));
        setSaving(false);
        if (ok) close();
    };

    const panel = (note: Note | null) => (
        <InlinePanel
            label={note ? t('note_edit') : tn('new_note')}
            onSave={save}
            onCancel={close}
            saving={saving}
            saveDisabled={!text.trim()}
            dirty={dirty}
            onDelete={note && canDelete ? remove : undefined}
            deleteLabel={t('note_delete')}
        >
            <label htmlFor={`${ids}-text`} className="sr-only">{tn('section_title')}</label>
            <textarea
                id={`${ids}-text`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                placeholder={t('note_placeholder')}
                className={cx(fieldClass(), 'text-base leading-relaxed resize-y min-h-[120px]')}
            />
        </InlinePanel>
    );

    return (
        <section id="place-notes" aria-labelledby="place-notes-title" ref={wrap}>
            <SectionHeader level="label" headingId="place-notes-title" title={tn('section_title')} count={list.length} />
            {notes == null ? (
                <div className="skeleton h-16 rounded-card" aria-hidden="true" />
            ) : list.length === 0 && !canEdit ? (
                <p className="m-0 text-sm text-text-muted">{tn('empty')}</p>
            ) : (
                <Card pad={false}>
                    {list.length > 0 && (
                        <ul className="list-none m-0 p-2">
                            {list.map((n) => (
                                <li key={n.Id} className="border-t border-border-light first:border-t-0">
                                    {open === n.Id && canEdit ? <div className="p-2">{panel(n)}</div> : (
                                        <button
                                            type="button"
                                            data-note-row={n.Id}
                                            disabled={!canEdit}
                                            onClick={() => start(n)}
                                            aria-label={canEdit ? tn('edit_for', { excerpt: excerpt(n.Text) }) : undefined}
                                            className="block w-full text-left rounded-btn border-0 bg-transparent px-2 py-2.5 enabled:hover:bg-hover-surface enabled:cursor-pointer focus-ring disabled:cursor-default"
                                        >
                                            <span className="block text-base leading-[1.6] text-text whitespace-pre-wrap break-words line-clamp-4">{n.Text}</span>
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    {canEdit && (open === 'new'
                        ? <div className={cx('p-4', list.length > 0 && 'border-t border-border-light')}>{panel(null)}</div>
                        : <AddRow data-note-add label={tn('add_button')} onClick={() => start(null)} className={cx(list.length > 0 && 'border-t border-border-light')} />)}
                </Card>
            )}
        </section>
    );
}
