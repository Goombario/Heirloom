'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { isMac } from '@/lib/platform';
import { fieldClass } from '@/app/components/ui';
import { FileText, Plus } from '@/lib/icons';
import { getDataClient } from '@/lib/data';
import { useErrorToast } from '@/app/components/useErrorToast';
import type { Note } from '@/lib/data/types';

/**
 * The hero "biographical note" on /people/view — a click-to-edit editorial quote,
 * kept from the retired InlineNotesCard because a single click into the biography
 * is the gesture that made this page feel like a document rather than a form.
 *
 * What changed underneath is only WHERE it writes: it edits the person's PREFERRED
 * note (`NoteLink.IsPrimary`, ADR 0010/0012) instead of the legacy `People."Notes"`
 * column. The notes list in the rail is the full CRUD surface; this slot is the one
 * note the page leads with.
 *
 * Writing here when the person has no preferred note CREATES one and marks it
 * preferred in the same gesture, so the slot is never a dead end — without that,
 * typing a biography would produce a note the hero then refuses to show.
 */
export function PrimaryNoteCard({
    personId,
    personName,
    treeId,
    primaryNote,
    canEdit,
    onChanged,
}: {
    personId: number;
    /** Given names for the empty prompt ("Add a biographical note about Percy Walter…"). */
    personName: string;
    treeId: number | null;
    /** The person's preferred note, or null when they have none yet. */
    primaryNote: Note | null;
    canEdit: boolean;
    /** Called after a successful write so the owning page can refresh its list. */
    onChanged: () => void;
}) {
    const t = useTranslations('personDetail');
    const tc = useTranslations('common');
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(primaryNote?.Text ?? '');
    const [saving, setSaving] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const { reportError } = useErrorToast();

    useEffect(() => {
        setDraft(primaryNote?.Text ?? '');
    }, [primaryNote]);

    useEffect(() => {
        if (editing && textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.selectionStart = textareaRef.current.value.length;
        }
    }, [editing]);

    async function save() {
        const text = draft.trim();
        const current = primaryNote?.Text ?? '';
        if (text === current) {
            setEditing(false);
            return;
        }
        setSaving(true);
        try {
            const client = await getDataClient();
            if (!text) {
                // Cleared. Detach from THIS person rather than editing to empty —
                // an empty note is not a thing, and unlink deletes it only when no
                // other owner still points at it, so a shared note survives.
                if (primaryNote) await client.notes.remove(primaryNote.Id, 'People', personId, treeId);
            } else if (primaryNote) {
                await client.notes.update(primaryNote.Id, 'People', personId, text, treeId);
                // The hero falls back to the oldest note when nothing is preferred yet
                // (every pre-existing person, since imports set IsPrimary = 0). Editing
                // through this slot is an explicit "this is the biography", so promote
                // it — otherwise the choice never gets recorded and a later note added
                // in the rail could silently take over the slot.
                if (primaryNote.IsPrimary !== 1) {
                    await client.notes.setPrimary(primaryNote.Id, 'People', personId, true, treeId);
                }
            } else {
                // Create + promote in one gesture: a note the hero would not show is
                // worse than no note at all.
                const created = await client.notes.create('People', personId, text, treeId);
                await client.notes.setPrimary(created.Id, 'People', personId, true, treeId);
            }
            onChanged();
            setEditing(false);
        } catch (e) {
            reportError(e);
        } finally {
            setSaving(false);
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            save();
        } else if (e.key === 'Escape') {
            setDraft(primaryNote?.Text ?? '');
            setEditing(false);
        }
    }

    // A fieldset + legend: the browser cuts the dashed border around the label, so it
    // sits on the frame's top edge with no fill to mask the dash (a fill showed as a
    // box over the hero's shadow). The legend's left bar straddles the frame corner.
    // The fieldset is a group named "Biography"; the button inside keeps its own name.
    // Existing tokens only.
    const frame = (children: React.ReactNode) => (
        <fieldset className="m-0 min-w-0 rounded-lg border border-dashed border-border p-0">
            <legend className="-ml-px border-l-[3px] border-l-[color:var(--color-text-secondary)] pl-5 pr-2 text-xs leading-4 uppercase tracking-[0.12em] text-text-muted">
                {t('bio_label')}
            </legend>
            {children}
        </fieldset>
    );
    const innerCls = 'flex items-start gap-4 w-full rounded-b-lg px-[18px] pt-1.5 pb-3.5';
    const icon = <FileText width={20} height={20} aria-hidden="true" className="shrink-0 mt-0.5 text-text-muted" />;

    if (editing && canEdit) {
        return (
            frame(
                <div className={innerCls}>
                    {icon}
                    <div className="flex-1 min-w-0">
                        <textarea
                            ref={textareaRef}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onBlur={save}
                            rows={4}
                            className={`${fieldClass()} resize-y serif`}
                            style={{ fontSize: 'var(--text-md)', lineHeight: 1.6, fontStyle: 'italic' }}
                            placeholder={t('bio_placeholder')}
                        />
                        <div className="muted text-xs mt-1.5">
                            {saving ? tc('saving') : t('bio_save_hint', { keys: isMac() ? '⌘S' : 'Ctrl+S' })}
                        </div>
                    </div>
                </div>
            )
        );
    }

    const content = primaryNote ? (
        <span className="serif text-md leading-[1.55] block flex-1 min-w-0" style={{ fontStyle: 'italic', color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
            {primaryNote.Text}
        </span>
    ) : (
        <span className="serif muted text-md leading-[1.55] block flex-1 min-w-0" style={{ fontStyle: 'italic' }}>
            {canEdit ? t('bio_prompt', { name: personName }) : t('bio_empty')}
        </span>
    );

    if (!canEdit) {
        return frame(<div className={innerCls}>{icon}{content}</div>);
    }

    const editDescriptionId = `bio-edit-description-${personId}`;
    return (
        <>
            {frame(
                <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-describedby={editDescriptionId}
                    className={`${innerCls} text-left cursor-pointer transition-colors hover:bg-hover-surface focus-ring`}
                >
                    {icon}
                    {content}
                    {/* Visual cue only: the button is named by its content and described by
                        bio_edit_aria, so the name stays the note text or the prompt. */}
                    <span aria-hidden="true" className="shrink-0 inline-flex items-center gap-1.5 text-sm text-link self-center">
                        {!primaryNote && <Plus width={16} height={16} aria-hidden="true" />}
                        {primaryNote ? tc('edit') : t('bio_add')}
                    </span>
                </button>
            )}
            <span id={editDescriptionId} className="sr-only">{t('bio_edit_aria')}</span>
        </>
    );
}
