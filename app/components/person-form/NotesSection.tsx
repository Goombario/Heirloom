'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FormSection, fieldClass } from '@/app/components/ui';
import { OwnerNotesCard, visibleNotes } from '@/app/components/notes/OwnerNotesCard';
import { useTree } from '@/app/contexts/TreeContext';
import type { UsePersonForm } from '@/app/components/person-form/usePersonForm';

/**
 * NotesSection — the person's notes, first-class `Note` + `NoteLink('People')`
 * rows in both modes, like every other owner (#524 / ADR 0010).
 *
 * EDIT mode: the shared OwnerNotesCard, which lists and writes them directly.
 *
 * NEW mode: there is no person id yet, so there is nothing for a NoteLink to point
 * at. The textarea holds a draft in `usePersonForm`, and submit() creates the
 * person first and then writes the Note against the returned id. It is NOT a
 * `People."Notes"` write — that column no longer exists.
 */
export default function NotesSection({ fm, mobile = false }: { fm: UsePersonForm; mobile?: boolean }) {
    const t = useTranslations('editPerson');
    const tNotes = useTranslations('notes');
    const { noteDraft, setNoteDraft, personId } = fm;
    const { activeTreeId, activePermission } = useTree();
    // FormSection's title is a plain string, so the count is appended as text
    // rather than through <NoteCount>. Same key, same "omit at zero" rule.
    const [noteCount, setNoteCount] = useState(0);
    const title = noteCount > 0
        ? `${t('section_notes')} ${tNotes('count', { count: noteCount })}`
        : t('section_notes');

    return (
        <FormSection title={title} mobile={mobile}>
            {personId === null ? (
                <textarea
                    rows={5}
                    className={`${fieldClass()} resize-y`}
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder={t('notes_placeholder')}
                />
            ) : (
                <OwnerNotesCard
                    ownerTable="People"
                    ownerId={personId}
                    treeId={activeTreeId}
                    canEdit={activePermission !== 'view'}
                    canDelete={activePermission === 'owner' || activePermission === 'edit'}
                    // Birth/Death notes are read on the person's timeline, beside the
                    // fact they describe — this form has no timeline, so it lists the
                    // unscoped ones only. Preferred stays: this writes the same notes
                    // the detail hero quotes.
                    factScope="unscoped"
                    onNotesChange={(notes) => setNoteCount(visibleNotes(notes, 'unscoped').length)}
                />
            )}
        </FormSection>
    );
}
