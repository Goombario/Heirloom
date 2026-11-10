'use client';

import { useRouter } from 'next/navigation';
import { useId } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import DateInput from '@/app/components/DateInput';
import PersonPicker from '@/app/components/PersonPicker';
import Cite from '@/app/components/Cite';
import AttachSourceSidebar from '@/app/components/AttachSourceSidebar';
import LocationField from '@/app/components/LocationField';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { Button, FormTopBar, FormTopBarTitle, MobileFormHeader, MobileFormFooter, FormSection, FieldLabel, Banner, InlineDataError, fieldClass, Lifespan, PageShell, SelectField } from '@/app/components/ui';
import { Plus } from '@/lib/icons';
import type { FamilyType } from '@/lib/db/schema';
import { displayFullName } from '@/lib/utils/names';
import { useFamilyForm, type FamilyFormMode } from './family-form/useFamilyForm';
import { partnersTitle, childRelationshipsOfRow } from './family-form/state';
import { CHILD_RELATIONSHIP_TYPE_VALUES } from '@/lib/child-relationship';
import type { ChildRelationshipType } from '@/lib/data/types';
import {
    PartnerRow,
    PersonAvatarMini,
    OtherPartnershipsCard,
} from './family-form/sections';

export default function FamilyForm(props: FamilyFormMode) {
    const router = useRouter();
    const t = useTranslations('editFamily');
    const tc = useTranslations('common');
    const fieldId = useId();
    const f = useFamilyForm(props);
    const {
        isNew, familyId, activeTreeId, formRef, form, handleChange, setMarriagePlaceResolution,
        marriagePlaceInitialChain, marriagePlaceId, setMarriagePlaceId,
        loading, saving, deleting, showDeleteConfirm, setShowDeleteConfirm, error,
        partner1, setPartner1, partner2, setPartner2,
        children, showChildPicker, setShowChildPicker,
        citations, sourceNumbers, citationError, citationsReady, partner1Families, partner2Families,
        partner1FamiliesError, partner2FamiliesError,
        retryPartner1Families, retryPartner2Families,
        attachTarget, setAttachTarget, setPendingCitations,
        handleSubmit, handleDelete, addChild, updateChildType, removeChild, cite, reloadCitations,
        guardNavigation, onNavigate,
    } = f;

    if (loading) {
        return (
            <PageShell variant="detail" className="flex flex-col" contentClassName="flex-1 flex items-center justify-center">
                <span className="muted">{tc('loading')}</span>
            </PageShell>
        );
    }

    const title = partnersTitle(partner1, partner2, t('add_partnership'));
    const relationshipOptions = CHILD_RELATIONSHIP_TYPE_VALUES.map((rt) => ({ value: rt, label: t(`rel_${rt.toLowerCase()}`) }));
    const shortName = (person: { FirstName?: string | null; LastName?: string | null }) =>
        person.FirstName?.trim() || displayFullName(person) || tc('unknown');
    const cancelHref = isNew ? '/families' : `/families/view?id=${familyId}`;

    return (
        <PageShell
            variant="detail"
            topBar={<>
                <FormTopBar column="detail" className="py-3.5 max-md:hidden" innerClassName="gap-3.5">
                    <div className="flex-1 min-w-0">
                        <FormTopBarTitle>{isNew ? t('add_partnership') : title}</FormTopBarTitle>
                        {/* New partnerships get no subtitle — it restated the form. The edit
                            subtitle stays: it carries the record id and marriage place. */}
                        {!isNew && (
                            <div className="muted text-meta mt-0.5">
                                {`${t('subtitle_edit', { id: familyId ?? '' })}${form.MarriagePlace ? ` · ${form.MarriagePlace}` : ''}`}
                            </div>
                        )}
                    </div>
                    <Button variant="ghost" onClick={() => { if (guardNavigation()) router.push(cancelHref); }}>{tc('cancel')}</Button>
                    <Button type="submit" form="family-form" disabled={saving} variant="primary">
                        {saving ? tc('saving') : (isNew ? t('save_partnership') : tc('save_changes'))}
                    </Button>
                </FormTopBar>
                {/* Phones: the same header and footer as every other form (#807). */}
                <MobileFormHeader className="md:hidden" backHref={cancelHref} backLabel={tc('back')} title={isNew ? t('add_partnership') : title} />
            </>}
            footer={
                <MobileFormFooter className="md:hidden">
                    <Button variant="outline" className="min-h-11 flex-1" onClick={() => { if (guardNavigation()) router.push(cancelHref); }}>{tc('cancel')}</Button>
                    <Button type="submit" form="family-form" disabled={saving} variant="primary" className="min-h-11 flex-[1.4]">
                        {saving ? tc('saving') : (isNew ? t('save_partnership') : tc('save_changes'))}
                    </Button>
                </MobileFormFooter>
            }
        >
                {error && (
                    <Banner tone="error" className="mb-3.5">{error}</Banner>
                )}

                <form id="family-form" ref={formRef} onSubmit={handleSubmit} autoComplete="off">
                    {/* The new-partnership form has no rail: its sources card is always
                        empty (attaching needs a saved family) and OtherPartnerships is
                        edit-only, so the sections run full width. */}
                    <div className={isNew ? 'grid grid-cols-1' : 'grid grid-cols-[minmax(0,1fr)_320px] gap-5.5 items-start'}>
                        {/* LEFT */}
                        <div>
                            {/* Partners */}
                            <FormSection title={t('section_partners')} hint={t('section_partners_hint')}>
                                <div className="flex flex-col gap-2.5">
                                    <PartnerRow
                                        index={1}
                                        person={partner1}
                                        otherSelectedId={partner2?.Id}
                                        onChange={setPartner1}
                                        treeId={activeTreeId}
                                    />
                                    <PartnerRow
                                        index={2}
                                        person={partner2}
                                        otherSelectedId={partner1?.Id}
                                        onChange={setPartner2}
                                        treeId={activeTreeId}
                                    />
                                </div>

                                {/* Type */}
                                <div className="mt-[18px] pt-3.5 border-t border-t-[color:var(--border-light)] grid grid-cols-2 gap-3.5">
                                    <FieldLabel label={t('type_label')} hint={t('type_hint')} htmlFor={`${fieldId}-type`}>
                                        <SelectField<FamilyType>
                                            id={`${fieldId}-type`}
                                            value={form.Type}
                                            onChange={(v) => handleChange('Type', v)}
                                            options={[
                                                { value: 'Marriage', label: t('type_marriage') },
                                                { value: 'Civil union', label: t('type_civil_union') },
                                                { value: 'Common-law', label: t('type_common_law') },
                                                { value: 'Other', label: t('type_other') },
                                                { value: 'Unknown', label: tc('unknown') },
                                            ]}
                                        />
                                    </FieldLabel>
                                </div>
                            </FormSection>

                            {/* Started */}
                            <FormSection title={t('section_started')} hint={t('section_started_hint')} cite={cite(t('section_started'))}>
                                <div className="grid grid-cols-1 gap-3.5">
                                    <FieldLabel label={t('date_label')} fullLabel={t('started_date')} htmlFor={`${fieldId}-start-date`}>
                                        <DateInput id={`${fieldId}-start-date`} value={form.MarriageDate} onChange={(v) => handleChange('MarriageDate', v)} className={fieldClass()} />
                                    </FieldLabel>
                                    <FieldLabel label={t('place_label')} fullLabel={t('started_place')} htmlFor={`${fieldId}-start-place`}>
                                        <LocationField
                                            id={`${fieldId}-start-place`}
                                            value={form.MarriagePlace}
                                            onChange={(v) => handleChange('MarriagePlace', v)}
                                            onResolve={setMarriagePlaceResolution}
                                            onRemove={() => setMarriagePlaceResolution(null)}
                                            initialChain={marriagePlaceInitialChain}
                                            placeId={marriagePlaceId}
                                            onPlaceIdChange={setMarriagePlaceId}
                                            treeId={activeTreeId}
                                            className={fieldClass()}
                                            placeholder={t('place_placeholder')}
                                        />
                                    </FieldLabel>
                                </div>
                            </FormSection>

                            {/* Partnership endings (divorce/annulment/separation) are now
                                events on the family's "Partnership timeline", not a form field. */}

                            {/* Children */}
                            <FormSection
                                title={t('children_title', { count: children.length })}
                                hint={isNew ? t('children_hint_new') : t('children_hint_edit')}
                            >
                                {children.length === 0 ? (
                                    <div className="muted text-sm py-3.5 px-0 text-center">
                                        {isNew ? t('children_empty_new') : t('children_empty')}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-1.5">
                                        {children.map((c, i) => {
                                            const p = c.person;
                                            const rel = childRelationshipsOfRow(c);
                                            return (
                                                <div key={p.Id} className="row gap-2.5 py-2 px-2.5 rounded-[6px] flex-wrap" style={{ background: 'var(--card-alt)' }}>
                                                    <span className="muted tabular-nums text-meta w-[18px]">{i + 1}.</span>
                                                    <PersonAvatarMini p={p} treeId={activeTreeId} />
                                                    <div className="flex-1 min-w-[120px]">
                                        <Link href={`/people/view?id=${p.Id}`} onNavigate={onNavigate} className="text-sm font-medium no-underline" style={{ color: 'var(--text)' }}>{displayFullName(p)}</Link>
                                                        <Lifespan birth={p.BirthDate} death={p.DeathDate} className="text-meta block" />
                                                    </div>
                                                    {/* One relationship per partner when both are set (#982): a
                                                        blended family's child is often one partner's birth child
                                                        and the other's stepchild. */}
                                                    {partner1 && partner2 ? (
                                                        <div className="flex flex-col gap-1">
                                                            {([['partner1', partner1], ['partner2', partner2]] as const).map(([slot, parent]) => (
                                                                <div key={slot} className="row gap-1.5 items-center">
                                                                    <span className="text-meta text-text-muted w-[72px] truncate text-right">{shortName(parent)}</span>
                                                                    <SelectField<ChildRelationshipType>
                                                                        value={rel[slot]}
                                                                        onChange={(v) => updateChildType(p.Id, v, slot)}
                                                                        size="sm"
                                                                        width="w-[110px]"
                                                                        aria-label={t('relationship_to', { name: shortName(parent) })}
                                                                        options={relationshipOptions}
                                                                    />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <SelectField<ChildRelationshipType>
                                                            value={partner2 && !partner1 ? rel.partner2 : rel.partner1}
                                                            onChange={(v) => updateChildType(p.Id, v)}
                                                            size="sm"
                                                            width="w-[110px]"
                                                            aria-label={t('relationship_type')}
                                                            options={relationshipOptions}
                                                        />
                                                    )}
                                                    <Button type="button" variant="ghost" size="sm" onClick={() => removeChild(p.Id)} className="p-1 text-xs" aria-label={t('remove')}>✕</Button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {/* Available on create too (#477): children staged here are
                                    flushed once the family row exists. */}
                                <div className="mt-3">
                                        {showChildPicker ? (
                                            <div>
                                                <PersonPicker
                                                    value={null}
                                                    onChange={(p) => p && addChild(p)}
                                                    showSex
                                                    showDates
                                                    // Partners are excluded alongside the children already
                                                    // listed: on create both pickers are live at once, and
                                                    // a partner offered as their own child is never right.
                                                    excludeIds={[...children.map((c) => c.person.Id), partner1?.Id, partner2?.Id].filter((id): id is number => typeof id === 'number')}
                                                    treeId={activeTreeId}
                                                    placeholder={t('search_child_placeholder')}
                                                    inline
                                                />
                                                <Button type="button" variant="ghost" onClick={() => setShowChildPicker(false)} className="mt-1.5">{tc('cancel')}</Button>
                                            </div>
                                        ) : (
                                            <Button type="button" variant="outline" icon={<Plus className="w-4 h-4" aria-hidden="true" />} onClick={() => setShowChildPicker(true)}>{t('add_child')}</Button>
                                        )}
                                </div>
                            </FormSection>

                            {/* Danger zone */}
                            {!isNew && (
                                <div className="card card-pad mb-5.5 py-3.5 px-4" style={{ borderColor: 'var(--error)' }}>
                                    <div className="row justify-between items-center">
                                        <div>
                                            <div className="font-medium text-sm" style={{ color: 'var(--error)' }}>{t('delete_partnership')}</div>
                                            <div className="muted text-meta mt-0.5">{t('delete_desc')}</div>
                                        </div>
                                        <Button type="button" variant="outline" onClick={() => setShowDeleteConfirm(true)} style={{ background: 'var(--card)', color: 'var(--error)', borderColor: 'var(--error)' }}>{tc('delete')}…</Button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* RIGHT RAIL — edit mode only */}
                        {!isNew && (
                        <div className="sticky top-24 flex flex-col gap-4">
                            <div className="card card-pad p-3.5">
                                <h3 className="serif text-base font-semibold mb-2.5">{t('sources_cited')}</h3>
                                {citationError && (
                                    <InlineDataError
                                        message={citationError}
                                        retryLabel={tc('retry')}
                                        onRetry={reloadCitations}
                                        className="mb-2"
                                    />
                                )}
                                {citations.length === 0 && !citationError ? (
                                    <div className="muted text-meta py-2 px-0">{t('none_yet')}</div>
                                ) : citations.length > 0 ? (
                                    <div className="flex flex-col gap-2">
                                        {citations.map((c) => (
                                            <div key={c.Id} className="row gap-2 items-start text-meta">
                                                <Cite n={sourceNumbers.get(c.SourceId)} sourceTitle={c.sourceTitle ?? undefined} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium">{c.sourceTitle ?? t('untitled_source')}</div>
                                                    {c.sourceType && <div className="muted text-xs mt-0.5">{c.sourceType}</div>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                                {!isNew && familyId && citationsReady && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        icon={<Plus className="w-4 h-4" aria-hidden="true" />}
                                        className="mt-2.5 text-meta"
                                        style={{ width: '100%' }}
                                        onClick={() => setAttachTarget({ factTable: 'Families', factId: familyId, factLabel: t('this_partnership') })}
                                    >
                                        {t('attach_source')}
                                    </Button>
                                )}
                            </div>

                            <OtherPartnershipsCard
                                // When a failed cold lookup has no stale rows, omit that
                                // partner from the card so its successful-empty copy is not
                                // mistaken for the failed result. A stale non-empty result
                                // remains visible alongside its region error.
                                p1={partner1FamiliesError && partner1Families.length === 0 ? null : partner1}
                                p2={partner2FamiliesError && partner2Families.length === 0 ? null : partner2}
                                p1Families={partner1Families}
                                p2Families={partner2Families}
                                currentFamilyId={familyId!}
                            />
                            {partner1FamiliesError && (
                                <InlineDataError
                                    message={partner1FamiliesError}
                                    retryLabel={tc('retry')}
                                    onRetry={retryPartner1Families}
                                    className="mt-3"
                                />
                            )}
                            {partner2FamiliesError && (
                                <InlineDataError
                                    message={partner2FamiliesError}
                                    retryLabel={tc('retry')}
                                    onRetry={retryPartner2Families}
                                    className="mt-3"
                                />
                            )}
                        </div>
                        )}
                    </div>
                </form>

            {/* Delete modal */}
            <ConfirmDialog
                open={showDeleteConfirm}
                variant="calm"
                tone="danger"
                title={t('delete_partnership')}
                body={t('delete_confirm')}
                confirmLabel={tc('yes_delete')}
                busy={deleting}
                onConfirm={handleDelete}
                onCancel={() => setShowDeleteConfirm(false)}
            />

            {/* Attach source sidebar */}
            {attachTarget && (isNew || citationsReady) && (
                <AttachSourceSidebar
                    factTable={attachTarget.factTable}
                    factId={isNew ? null : attachTarget.factId}
                    factLabel={attachTarget.factLabel}
                    existingCitations={isNew ? undefined : citations}
                    onClose={() => setAttachTarget(null)}
                    onPending={isNew ? (pc) => setPendingCitations((prev) => [...prev, pc]) : undefined}
                    onAttached={() => { if (!isNew && familyId) reloadCitations(); }}
                />
            )}
        </PageShell>
    );
}
