'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClearDeathConfirm } from '@/app/components/person-form/ClearDeathConfirm';
import { useTranslations } from 'next-intl';
import { formatDateForDisplay } from '@/lib/date-utils';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import DateInput from '@/app/components/DateInput';
import { factPlaceEntry } from '@/lib/places/place-key';
import LocationField from '@/app/components/LocationField';
import PersonAvatar from '@/app/components/PersonAvatar';
import { useLanguage } from '@/app/components/LanguageProvider';
import { Button, FieldLabel, Input, LeadText, Lifespan, SegmentedControl, SelectField, fieldClass } from '@/app/components/ui';
import { prefetchPerson } from '@/app/people/view/personCache';
import { ChevronDown, Target, X } from '@/lib/icons';
import { getDataClient } from '@/lib/data';
import type { Note } from '@/lib/data/types';
import { OwnerNotesCard, NoteCount, biographyNote, visibleNotes } from '@/app/components/notes/OwnerNotesCard';
import type { useTreePersonEditor } from './useTreePersonEditor';

type Editor = ReturnType<typeof useTreePersonEditor>;

const inputClass = fieldClass('sm');
const readClass = 'text-sm text-text';

export function SidebarContent({ editor, personId, onFocusPerson, panel = false, onClose }: {
    editor: Editor;
    personId: number;
    onFocusPerson: (id: number) => void;
    /** The v1.1 desktop person panel (#71, lg and up): navy head, preferred note,
     *  two fields to a row, Sex as a select, a pinned footer. Below lg: as before. */
    panel?: boolean;
    /** The panel's own close button, in its navy head. */
    onClose?: () => void;
}) {
    const router = useRouter();
    const tCommon = useTranslations('common');
    const t = useTranslations('treeSidebar');
    // The person hero editor's labels and option lists (#761), so the two can't drift.
    const tEdit = useTranslations('editPerson');
    const fieldId = useId();
    const { language } = useLanguage();
    const dateWords = useDateQualifierWords();
    const {
        form, setForm, isReadOnly, canDelete, primaryPhotoId, primaryPhotoFocal, activeTreeId,
        displayName, initials, notesExpanded, setNotesExpanded, isDirty, saving,
        loadedPersonId, handleSave, handleDiscard, handleDeceasedChange,
        confirmClearDeath, handleConfirmClearDeath, handleCancelClearDeath,
        placeChains, placeIds, setPlaceId, setBirthPlaceResolution, setDeathPlaceResolution,
        guardNavigation,
    } = editor;
    // A read-only field is text, so its label points at no control.
    const forId = (name: string) => (isReadOnly ? undefined : `${fieldId}-${name}`);
    // Only mounted while expanded, so this is 0 until the user opens the section
    // — deliberate: the sidebar does not fetch notes for every person clicked.
    const [noteCount, setNoteCount] = useState(0);
    // The panel's preferred note (#71, from #555): read while the Notes row is shut,
    // so a click on a card fetches this one owner's notes, not the notes card.
    const [lead, setLead] = useState<{ personId: number; note: Note | null } | null>(null);
    const leadNote = lead?.personId === personId ? lead.note : null;
    useEffect(() => {
        if (!panel || notesExpanded || loadedPersonId !== personId) return;
        let live = true;
        void (async () => {
            try {
                const notes = await (await getDataClient()).notes.listForOwner('People', personId, activeTreeId);
                if (live) setLead({ personId, note: biographyNote(visibleNotes(notes, 'unscoped')) });
            } catch {
                if (live) setLead({ personId, note: null });
            }
        })();
        return () => { live = false; };
    }, [panel, notesExpanded, loadedPersonId, personId, activeTreeId]);

    const openPage = () => { if (guardNavigation()) router.push(`/people/view?id=${personId}`); };
    const prefetch = () => prefetchPerson(personId, activeTreeId);

    const firstNameField = (
        <>
            <FieldLabel label={tEdit('first_name')}>
                {isReadOnly ? (
                    <div className={readClass}>{form.FirstName || '-'}</div>
                ) : (
                    <Input size="sm" value={form.FirstName} onChange={(e) => setForm((f) => ({ ...f, FirstName: e.target.value }))} aria-label={tEdit('first_name')} autoComplete="off" />
                )}
            </FieldLabel>
        </>
    );
    const lastNameField = (
        <>
            <FieldLabel label={tEdit('last_name')}>
                {isReadOnly ? (
                    <div className={readClass}>{form.LastName || '-'}</div>
                ) : (
                    <Input size="sm" value={form.LastName} onChange={(e) => setForm((f) => ({ ...f, LastName: e.target.value }))} aria-label={tEdit('last_name')} autoComplete="off" />
                )}
            </FieldLabel>
        </>
    );
    const sexSegments = (
        <>
            {/* Same four buckets as the person editor's Sex control ('X' =
                non-binary). Without 'X' here, an X person read as "Unknown"
                and the first save silently rewrote them to null. */}
            <FieldLabel label={tEdit('sex')}>
                <SegmentedControl
                    value={form.Sex === 'M' || form.Sex === 'F' || form.Sex === 'X' ? form.Sex : ''}
                    onChange={(v) => setForm((f) => ({ ...f, Sex: v === '' ? null : v as 'M' | 'F' | 'X' }))}
                    aria-label={tEdit('sex')}
                    disabled={isReadOnly}
                    fullWidth
                    options={[
                        { v: '', l: tCommon('unknown') },
                        { v: 'M', l: tEdit('sex_male') },
                        { v: 'F', l: tEdit('sex_female') },
                        { v: 'X', l: tEdit('sex_nonbinary') },
                    ]}
                />
            </FieldLabel>
        </>
    );
    const birthDateField = (
        <>
            <FieldLabel label={t('date_of_birth')} htmlFor={forId('birth-date')}>
                {isReadOnly ? (
                    <div className={form.BirthDate ? 'date-mono text-sm' : 'text-sm text-text-muted'}>{form.BirthDate ? formatDateForDisplay(form.BirthDate, language, dateWords) : '-'}</div>
                ) : (
                    <DateInput id={forId('birth-date')} value={form.BirthDate} onChange={(v) => setForm(f => ({ ...f, BirthDate: v }))} className={inputClass} placeholder={t('birth_date_placeholder')} />
                )}
            </FieldLabel>
        </>
    );
    const birthPlaceField = (
        <>
            {/* Place of birth — LocationField, not a raw input (#461). This was
                the only writer of a place string in the app that bypassed
                resolution, so a place typed here got no pin and no gazetteer
                link while the same edit made anywhere else did. */}
            <FieldLabel label={t('place_of_birth')} htmlFor={forId('birth-place')}>
                {isReadOnly ? (
                    <div className={readClass}>{form.BirthPlace || '-'}</div>
                ) : (
                    <LocationField
                        // Keyed per person: the sidebar stays mounted while
                        // personId changes, and LocationField holds its own
                        // levels/removed/userTouched. Without this, Ada's badge
                        // shows under Grace's place, the latched userTouched
                        // permanently blocks Grace's saved-chain badge, and an
                        // in-flight resolve for Ada lands as a pending write on
                        // Grace. Remounting also aborts that resolve.
                        key={personId}
                        id={forId('birth-place')}
                        value={form.BirthPlace}
                        onChange={(v) => setForm((f) => ({ ...f, BirthPlace: v }))}
                        onResolve={setBirthPlaceResolution}
                        onRemove={() => setBirthPlaceResolution(null)}
                        initialChain={factPlaceEntry(placeChains, form.BirthPlace, placeIds.birth) ?? null}
                        placeId={placeIds.birth}
                        onPlaceIdChange={(id) => setPlaceId('birth', id)}
                        treeId={activeTreeId}
                        className={inputClass}
                        placeholder={t('place_placeholder')}
                    />
                )}
            </FieldLabel>
        </>
    );
    const livingField = (
        <>
            <FieldLabel label={tCommon('living_status')}>
                <SegmentedControl
                    value={form.IsDeceased === 1 ? '1' : form.IsDeceased === 0 ? '0' : ''}
                    onChange={(v) => handleDeceasedChange(v === '1' ? 1 : v === '0' ? 0 : null)}
                    aria-label={tCommon('living_status')}
                    disabled={isReadOnly}
                    fullWidth
                    options={[
                        { v: '', l: tCommon('unknown') },
                        { v: '0', l: tCommon('living') },
                        { v: '1', l: tCommon('deceased') },
                    ]}
                />
            </FieldLabel>
        </>
    );
    const deathDateField = (
        <>
            <FieldLabel label={t('date_of_death')} htmlFor={forId('death-date')}>
                {isReadOnly ? (
                    <div className={form.DeathDate ? 'date-mono text-sm' : 'text-sm text-text-muted'}>{form.DeathDate ? formatDateForDisplay(form.DeathDate, language, dateWords) : '-'}</div>
                ) : (
                    <DateInput id={forId('death-date')} value={form.DeathDate} onChange={(v) => setForm(f => ({ ...f, DeathDate: v }))} className={inputClass} placeholder={t('death_date_placeholder')} />
                )}
            </FieldLabel>
        </>
    );
    const deathPlaceField = (
        <>
            <FieldLabel label={t('place_of_death')} htmlFor={forId('death-place')}>
                {isReadOnly ? (
                    <div className={readClass}>{form.DeathPlace || '-'}</div>
                ) : (
                    <LocationField
                        key={personId} // see the birth-place field
                        id={forId('death-place')}
                        value={form.DeathPlace}
                        onChange={(v) => setForm((f) => ({ ...f, DeathPlace: v }))}
                        onResolve={setDeathPlaceResolution}
                        onRemove={() => setDeathPlaceResolution(null)}
                        initialChain={factPlaceEntry(placeChains, form.DeathPlace, placeIds.death) ?? null}
                        placeId={placeIds.death}
                        onPlaceIdChange={(id) => setPlaceId('death', id)}
                        treeId={activeTreeId}
                        className={inputClass}
                        placeholder={t('place_placeholder')}
                    />
                )}
            </FieldLabel>
        </>
    );
    const notesSection = (
        <>
            {/* Notes section */}
            <div className="mt-4 pt-3 border-t border-border">
                <button
                    type="button"
                    onClick={() => setNotesExpanded((v) => !v)}
                    className={panel
                        ? 'flex items-center justify-between w-full min-h-9 text-sm font-medium text-text cursor-pointer focus-ring rounded-[6px]'
                        : 'flex items-center justify-between w-full text-xs font-medium text-text-secondary hover:text-text transition-colors'}
                    aria-expanded={notesExpanded}
                >
                    {/* The panel's Notes row is a closed row with a chevron, no count (#71). */}
                    <span>{t('notes')}{!panel && <> <NoteCount count={noteCount} /></>}</span>
                    <ChevronDown width={14} height={14} aria-hidden="true" className={`transition-transform ${notesExpanded ? 'rotate-180' : ''}`} />
                </button>
                {/* First-class Note + NoteLink rows, replacing the legacy
                    People."Notes" textarea (ADR 0010 / #407). ADR 0010 flagged this
                    one specifically: a single collapsible textarea had to become a
                    list once a person can hold several notes. Mounted only when
                    expanded so the tree sidebar does not fetch notes for every
                    person the user clicks through. */}
                {notesExpanded && (
                    <div className="mt-2">
                        <OwnerNotesCard
                            ownerTable="People"
                            ownerId={personId}
                            treeId={activeTreeId}
                            canEdit={!isReadOnly}
                            canDelete={canDelete}
                            // Birth/Death notes are read on the person's timeline;
                            // this sidebar lists the unscoped ones. Nothing here
                            // reads IsPrimary either, so the preferred affordance
                            // would be a control with no effect.
                            factScope="unscoped"
                            showPreferred={false}
                            onNotesChange={(notes) => setNoteCount(visibleNotes(notes, 'unscoped').length)}
                        />
                    </div>
                )}
            </div>
        </>
    );

    const clearDeathConfirm = (
        <ClearDeathConfirm
            status={confirmClearDeath ? (form.IsDeceased === 0 ? 'living' : 'unknown') : null}
            name={displayName}
            onConfirm={handleConfirmClearDeath}
            onCancel={handleCancelClearDeath}
        />
    );

    // Below lg (and the phone sheet): the layout as it was before #71.
    if (!panel) {
        return (
            <div className={`flex flex-col ${loadedPersonId !== personId ? 'pointer-events-none' : ''}`}>
                <div className="p-5 flex-1">
                    {/* Avatar */}
                    <div className="flex justify-center mb-3">
                        <PersonAvatar
                            mediaId={primaryPhotoId}
                            treeId={activeTreeId}
                            name={displayName}
                            initials={initials}
                            sex={form.Sex}
                            size={72}
                            focalX={primaryPhotoFocal.x}
                            focalY={primaryPhotoFocal.y}
                            focalRadius={primaryPhotoFocal.r}
                        />
                    </div>

                    {/* Name display */}
                    <h2 className="serif text-md" style={{ fontWeight: 700, color: 'var(--text)', textAlign: 'center', marginBottom: 12 }}>{displayName}</h2>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                        <Button variant="outline" onClick={openPage} onMouseEnter={prefetch} onFocus={prefetch} size="sm" className="flex-1">
                            {t('full_profile')}
                        </Button>
                        <Button variant="primary" onClick={() => onFocusPerson(personId)} size="sm" className="flex-1">
                            {t('focus_person')}
                        </Button>
                    </div>

                    <hr className="border-border mb-4" />

                    {/* Inline editable fields — the person hero editor's field pieces, labels
                        and option order (#761): sentence-case FieldLabels, SegmentedControls
                        with Unknown first. */}
                    <div className="space-y-3">
                        {firstNameField}
                        {lastNameField}
                        {sexSegments}
                        {birthDateField}
                        {birthPlaceField}
                        {livingField}
                        {/* Death date / place — shown only when deceased */}
                        {form.IsDeceased === 1 && <>{deathDateField}{deathPlaceField}</>}
                    </div>

                    {notesSection}
                </div>

                {/* Sticky Save / Discard footer — only when dirty and editable */}
                {!isReadOnly && isDirty && (
                    <div style={{ position: 'sticky', bottom: 0, background: 'var(--card)', borderTop: '1px solid var(--border)', padding: '10px 16px calc(10px + env(safe-area-inset-bottom, 0px))', display: 'flex', gap: 6 }}>
                        <Button variant="outline" onClick={handleDiscard} disabled={saving} size="sm" className="flex-1">
                            {t('discard')}
                        </Button>
                        <Button variant="primary" onClick={() => { void handleSave(); }} disabled={saving} size="sm" className="flex-1">
                            {saving ? t('saving') : t('save_changes')}
                        </Button>
                    </div>
                )}
                {clearDeathConfirm}
            </div>
        );
    }

    // The v1.1 desktop person panel (#71): navy head, actions, the preferred note,
    // the quick edit two to a row, and a pinned footer.
    const sexValue = form.Sex === 'M' || form.Sex === 'F' || form.Sex === 'X' ? form.Sex : '';
    return (
        <div className={`flex flex-col min-h-full ${loadedPersonId !== personId ? 'pointer-events-none' : ''}`}>
            <div className="dark-island tree-panel-head relative flex flex-col items-center gap-2 px-5 pt-6 pb-5 text-center bg-[color:var(--color-hero-bg)]">
                {onClose && (
                    <button type="button" onClick={onClose} aria-label={tCommon('close')} title={tCommon('close')}
                        className="absolute top-2.5 right-2.5 grid place-items-center w-8 h-8 rounded-btn text-text-secondary hover:text-text hover:bg-surface-2 cursor-pointer focus-ring">
                        <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                )}
                <PersonAvatar
                    mediaId={primaryPhotoId}
                    treeId={activeTreeId}
                    name={displayName}
                    initials={initials}
                    sex={form.Sex}
                    size={64}
                    focalX={primaryPhotoFocal.x}
                    focalY={primaryPhotoFocal.y}
                    focalRadius={primaryPhotoFocal.r}
                    className="rounded-full ring-2 ring-white"
                />
                <h2 className="serif text-md font-bold text-text m-0">{displayName}</h2>
                {(form.BirthDate || form.DeathDate) && (
                    <Lifespan birth={form.BirthDate || null} death={form.DeathDate || null} className="text-meta" />
                )}
            </div>

            <div className="flex gap-2 px-5 py-4">
                <Button variant="primary" onClick={openPage} onMouseEnter={prefetch} onFocus={prefetch} size="sm" className="flex-1">
                    {t('full_profile')}
                </Button>
                <Button variant="outline" onClick={() => onFocusPerson(personId)} size="sm" className="flex-1"
                    icon={<Target className="w-3.5 h-3.5" aria-hidden="true" />}>
                    {t('focus_person')}
                </Button>
            </div>

            {leadNote && !notesExpanded && (
                <div className="px-5 py-3.5 border-t border-border-light">
                    <div className="eyebrow mb-1.5">{t('note')}</div>
                    <LeadText className="text-sm">{leadNote.Text}</LeadText>
                </div>
            )}

            <div className="flex-1 px-5 py-4 border-t border-border-light space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                    <div className="min-w-0">{firstNameField}</div>
                    <div className="min-w-0">{lastNameField}</div>
                </div>
                <FieldLabel label={tEdit('sex')} htmlFor={forId('sex')}>
                    {isReadOnly ? (
                        <div className={readClass}>{sexValue === 'M' ? tEdit('sex_male') : sexValue === 'F' ? tEdit('sex_female') : sexValue === 'X' ? tEdit('sex_nonbinary') : tCommon('unknown')}</div>
                    ) : (
                        <SelectField<'' | 'M' | 'F' | 'X'>
                            id={forId('sex')}
                            size="sm"
                            value={sexValue}
                            onChange={(v) => setForm((f) => ({ ...f, Sex: v === '' ? null : v }))}
                            options={[
                                { value: '', label: tCommon('unknown') },
                                { value: 'M', label: tEdit('sex_male') },
                                { value: 'F', label: tEdit('sex_female') },
                                { value: 'X', label: tEdit('sex_nonbinary') },
                            ]}
                        />
                    )}
                </FieldLabel>
                {livingField}
                {/* Date and place each get the full width: a resolved place's pin
                    chip and its name overflowed half a 340px panel. */}
                {birthDateField}
                {birthPlaceField}
                {form.IsDeceased === 1 && <>{deathDateField}{deathPlaceField}</>}
                {notesSection}
            </div>

            {!isReadOnly && (
                <div className="sticky bottom-0 flex gap-2 px-5 py-3 bg-card border-t border-border">
                    <Button variant="outline" onClick={handleDiscard} disabled={saving || !isDirty} size="sm" className="flex-1">
                        {t('discard')}
                    </Button>
                    <Button variant="primary" onClick={() => { void handleSave(); }} disabled={saving || !isDirty} size="sm" className="flex-1">
                        {saving ? t('saving') : t('save_changes')}
                    </Button>
                </div>
            )}
            {clearDeathConfirm}
        </div>
    );
}
