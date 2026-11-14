'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PersonResult } from '@/lib/db/schema';
import type { ChildRelationshipType } from '@/lib/data/types';
import type { FamilySuggestion } from '@/lib/family-suggestions';
import { getDataClient } from '@/lib/data';
import { FACT_TABLES, type FactTableValue } from '@/lib/db/fact-tables';
import { formatYearOrEmpty, sortableYear } from '@/lib/date-utils';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import { ArrowUpRight, ChevronRight, Plus, Search, Trash2 } from '@/lib/icons';
import DateInput from '@/app/components/DateInput';
import LocationField from '@/app/components/LocationField';
import PersonAvatar from '@/app/components/PersonAvatar';
import {
    EMPTY_DRAFT, PersonPickerSheet, ShortPersonForm, toNewPerson,
    type DraftFields, type NewPersonDraft, type PickedPerson,
} from '@/app/components/PersonPickerSheet';
import { CiteSheets, type CiteSheetTarget } from '@/app/components/citations/CiteSheets';
import { usePersonForm, type FamilySearchResult, type UsePersonForm } from '@/app/components/person-form/usePersonForm';
import { useCachedResource } from '@/app/components/useCachedResource';
import { Banner, FilterChip, Lifespan, MobileRow, SegmentedControl, citeClass, cx, fieldClass } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { peopleListKey } from './peopleListKey';

/*
 * Add person on the phone (#1065): a full-height sheet over the people list, from the
 * locked mockup (v7). Essentials first (names, sex, born, status), the death only for
 * someone deceased, then the family, always open: likely family as one-tap rows, the
 * parents, a partner and children, each from a picker that can also stage a new person.
 * Everything is written on Save by usePersonForm, the desktop form's own logic, so every
 * field today's form has is kept. No "Save and add another" here; desktop keeps it.
 */

/** The six name types (ADR 0001), in the chips' order. */
const NAME_TYPES = ['Nickname', 'Maiden', 'Married', 'Anglicized', 'Alias', 'Given'] as const;

/** What the parents choice can be: Step and the others are set from the family page (#982). */
const PARENT_TYPES: ChildRelationshipType[] = ['Birth', 'Adoption', 'Foster'];

/** A child is plausibly born this many years after the parent. */
const CHILD_WINDOW = { from: 16, to: 50 };

const FIELD = cx(fieldClass(), 'min-h-11');

type Status = '' | '0' | '1';

export function AddPersonSheet({ open, onClose, treeId }: { open: boolean; onClose: () => void; treeId: number | null }) {
    // A fresh form each time it opens. The last one stays mounted while the sheet
    // animates away, then goes, so its unsaved-changes guard goes with it.
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(open);
    const [mounted, setMounted] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) { setOpened((n) => n + 1); setMounted(true); }
    }
    useEffect(() => {
        if (open || !mounted) return;
        const timer = window.setTimeout(() => setMounted(false), 500);
        return () => window.clearTimeout(timer);
    }, [open, mounted]);
    if (!mounted) return null;
    return <AddPersonBody key={opened} open={open} onClose={onClose} treeId={treeId} />;
}

/** Which picker or step sheet is on top of the form. */
type Sub = null | 'name' | 'parents' | 'partner' | 'children';

function AddPersonBody({ open, onClose, treeId }: { open: boolean; onClose: () => void; treeId: number | null }) {
    const t = useTranslations('mobileAddPerson');
    const fm = usePersonForm({ mode: 'new' });
    const { form, setField } = fm;
    const ids = useId();
    const [sub, setSub] = useState<Sub>(null);
    const [editingName, setEditingName] = useState<number | null>(null);
    const [citing, setCiting] = useState<CiteSheetTarget | null>(null);
    const [statusAsk, setStatusAsk] = useState<'0' | '' | null>(null);
    const [showNote, setShowNote] = useState(false);
    const bodyRef = useRef<HTMLDivElement>(null);

    const fullName = [form.FirstName.trim(), form.LastName.trim()].filter(Boolean).join(' ');
    const given = form.FirstName.trim().split(/\s+/)[0] || t('this_person');
    const hasName = fullName !== '';

    // First name takes focus once the sheet has risen.
    useEffect(() => {
        if (!open) return;
        const timer = window.setTimeout(() => fm.firstNameRef.current?.focus(), 320);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const focusById = (id: string) => requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>(`[id="${id}"]`)?.focus());

    const setStatus = (v: Status) => {
        const hasDeath = Boolean(form.DeathDate.trim() || form.DeathPlace.trim() || form.DeathCause.trim());
        if (form.IsDeceased === '1' && v !== '1' && hasDeath) { setStatusAsk(v); return; }
        setField('IsDeceased', v);
        if (v === '1') focusById(`${ids}-ddate`);
    };
    const clearDeath = () => {
        if (statusAsk == null) return;
        setField('DeathDate', '');
        setField('DeathPlace', '');
        setField('DeathCause', '');
        fm.setDeathPlaceResolution(undefined);
        setField('IsDeceased', statusAsk);
        setStatusAsk(null);
    };

    const cite = (factTable: FactTableValue, label: string) => setCiting({
        fact: { factTable, factId: -1, label, value: '', citations: [] },
        start: 'pick',
    });
    const pendingFor = (factTable: FactTableValue) => fm.pendingCitations.filter((p) => p.factTable === factTable).length;
    const citeLink = (factTable: FactTableValue, label: string) => (
        <CiteLink count={pendingFor(factTable)} label={t('cite')} aria={t('cite_fact', { fact: label })} onClick={() => cite(factTable, label)} />
    );

    const save = () => { void fm.submit({ addAnother: false }); };

    return (
        <Sheet
            open={open}
            onClose={onClose}
            title={t('title')}
            size="full"
            dirty={fm.isDirty}
            onSave={save}
            saveDisabled={fm.saving || !hasName}
            discardMessage={hasName ? t('discard_named', { name: fullName }) : t('discard_unnamed')}
        >
            <div ref={bodyRef}>
                {fm.error && <Banner tone="error" className="mb-3">{fm.error}</Banner>}

                {/* ── Name ── */}
                <Group title={t('group_name')} end={citeLink(FACT_TABLES.PERSON_NAME, t('group_name'))} first>
                    <Field id={`${ids}-first`} label={t('first_name')}>
                        <input id={`${ids}-first`} ref={fm.firstNameRef} type="text" value={form.FirstName} autoComplete="off" autoCapitalize="words"
                            placeholder={t('first_placeholder')} aria-invalid={fm.fieldErrors.FirstName || undefined}
                            onChange={(e) => setField('FirstName', e.target.value)} className={FIELD} />
                    </Field>
                    <Field id={`${ids}-last`} label={t('last_name')}>
                        <input id={`${ids}-last`} type="text" value={form.LastName} autoComplete="off" autoCapitalize="words"
                            placeholder={t('last_placeholder')} aria-invalid={fm.fieldErrors.LastName || undefined}
                            onChange={(e) => setField('LastName', e.target.value)} className={FIELD} />
                    </Field>
                    <div className="-mx-4">
                        {fm.variants.map((v, i) => (
                            <MobileRow key={v.Id} divided={i > 0} label={<span className="serif text-md font-semibold">{v.Name}</span>}
                                sub={v.IsPrimary ? t('name_primary_sub', { type: nameType(t, v.Type) }) : nameType(t, v.Type)}
                                end="chevron" onClick={() => { setEditingName(v.Id); setSub('name'); }} />
                        ))}
                        <MobileRow divided={fm.variants.length > 0} icon={<Plus />} end="chevron" label={t('add_name')}
                            onClick={() => { setEditingName(null); setSub('name'); }} />
                    </div>
                    <Duplicates fm={fm} treeId={treeId} />
                    <div className="grid gap-1.5">
                        <span className="text-meta font-medium text-text-secondary" aria-hidden="true">{t('sex')}</span>
                        <SegmentedControl aria-label={t('sex')} fullWidth value={form.Sex} onChange={(v) => setField('Sex', v)}
                            options={[
                                { v: '', l: t('sex_unknown') },
                                { v: 'M', l: t('sex_male') },
                                { v: 'F', l: t('sex_female') },
                                { v: 'X', l: t('sex_nonbinary') },
                            ]} />
                    </div>
                </Group>

                {/* ── Born, status, died ── */}
                <Group title={t('group_born')} end={citeLink(FACT_TABLES.PERSON_BIRTH, t('group_born'))}>
                    <Field id={`${ids}-bdate`} label={t('date')}>
                        <DateInput id={`${ids}-bdate`} value={form.BirthDate} onChange={(v) => setField('BirthDate', v)} touch className={FIELD} />
                    </Field>
                    <Field id={`${ids}-bplace`} label={t('place')}>
                        <LocationField id={`${ids}-bplace`} value={form.BirthPlace} onChange={(v) => setField('BirthPlace', v)}
                            onResolve={fm.setBirthPlaceResolution} onRemove={() => fm.setBirthPlaceResolution(null)}
                            placeId={fm.placeIds.birth} onPlaceIdChange={(id) => fm.setPlaceId('birth', id)} variant="sheet" label={t('group_born')}
                            treeId={treeId} className={FIELD} placeholder={t('place_placeholder')} />
                    </Field>
                </Group>

                <Group>
                    <div className="grid gap-1.5">
                        <span className="text-meta font-medium text-text-secondary" aria-hidden="true">{t('status')}</span>
                        <SegmentedControl aria-label={t('status')} fullWidth value={form.IsDeceased} onChange={(v) => setStatus(v as Status)}
                            options={[
                                { v: '', l: t('status_unknown') },
                                { v: '0', l: t('status_living') },
                                { v: '1', l: t('status_deceased') },
                            ]} />
                    </div>
                </Group>

                {form.IsDeceased === '1' && (
                    <Group title={t('group_died')} end={citeLink(FACT_TABLES.PERSON_DEATH, t('group_died'))}>
                        <Field id={`${ids}-ddate`} label={t('date')}>
                            <DateInput id={`${ids}-ddate`} value={form.DeathDate} onChange={(v) => setField('DeathDate', v)} touch className={FIELD} />
                        </Field>
                        <Field id={`${ids}-dplace`} label={t('place')}>
                            <LocationField id={`${ids}-dplace`} value={form.DeathPlace} onChange={(v) => setField('DeathPlace', v)}
                                onResolve={fm.setDeathPlaceResolution} onRemove={() => fm.setDeathPlaceResolution(null)}
                                placeId={fm.placeIds.death} onPlaceIdChange={(id) => fm.setPlaceId('death', id)} variant="sheet" label={t('group_died')}
                                treeId={treeId} className={FIELD} placeholder={t('place_placeholder')} />
                        </Field>
                        <Field id={`${ids}-dcause`} label={t('cause')}>
                            <input id={`${ids}-dcause`} type="text" value={form.DeathCause} autoComplete="off" placeholder={t('cause_placeholder')}
                                onChange={(e) => setField('DeathCause', e.target.value)} className={FIELD} />
                        </Field>
                    </Group>
                )}

                {/* ── Family ── */}
                <FamilyGroup fm={fm} treeId={treeId} given={given} ids={ids} onOpen={setSub} />

                {/* ── Notes ── */}
                {showNote || fm.noteDraft ? (
                    <Group title={t('group_notes')}>
                        <label htmlFor={`${ids}-note`} className="sr-only">{t('group_notes')}</label>
                        <textarea id={`${ids}-note`} value={fm.noteDraft} rows={4} placeholder={t('note_placeholder')}
                            onChange={(e) => fm.setNoteDraft(e.target.value)} className={cx(fieldClass(), 'min-h-24 py-2.5 resize-none')} />
                    </Group>
                ) : (
                    <Group title={t('group_notes')}>
                        <div className="-mx-4 -mt-1">
                            <MobileRow icon={<Plus />} label={t('add_note')} onClick={() => { setShowNote(true); focusById(`${ids}-note`); }} />
                        </div>
                    </Group>
                )}
            </div>

            <NameStep open={sub === 'name'} onClose={() => setSub(null)} fm={fm} variantId={editingName} given={given} />
            <ParentsStep open={sub === 'parents'} onClose={() => setSub(null)} fm={fm} given={given} />
            <PartnerStep open={sub === 'partner'} onClose={() => setSub(null)} fm={fm} treeId={treeId} given={given} />
            <ChildrenStep open={sub === 'children'} onClose={() => setSub(null)} fm={fm} treeId={treeId} given={given} />

            <CiteSheets
                target={citing}
                subject={fullName || t('title')}
                sourceNumbers={new Map()}
                canCite
                canDelete={false}
                research={null}
                onClose={() => setCiting(null)}
                onChanged={() => {}}
                onPending={fm.pushPendingCitation}
            />

            <ConfirmSheet
                open={statusAsk != null}
                title={t('clear_death_title', { status: statusAsk === '0' ? 'living' : 'unknown' })}
                body={t('clear_death_body')}
                confirmLabel={t('clear_death_confirm')}
                keepLabel={t('keep_death')}
                onConfirm={clearDeath}
                onClose={() => setStatusAsk(null)}
            />
            {/* The form's own check on Save, should a death survive a status change. */}
            <ConfirmSheet
                open={fm.clearDeathPending != null}
                title={t('clear_death_title', { status: form.IsDeceased === '0' ? 'living' : 'unknown' })}
                body={t('clear_death_body')}
                confirmLabel={t('clear_death_confirm')}
                keepLabel={t('keep_death')}
                onConfirm={fm.confirmClearDeath}
                onClose={fm.cancelClearDeath}
            />
        </Sheet>
    );
}

/* ── Layout pieces ───────────────────────────────────────────────────────── */

function Group({ title, end, first = false, children }: { title?: string; end?: React.ReactNode; first?: boolean; children: React.ReactNode }) {
    return (
        <section className={cx('grid gap-2.5 pb-4', first ? 'pt-1' : 'pt-4 border-t border-border')}>
            {(title || end) && (
                <div className="flex items-center justify-between gap-2 min-h-6">
                    {title && <h3 className="eyebrow m-0">{title}</h3>}
                    {end}
                </div>
            )}
            {children}
        </section>
    );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
    return (
        <div className="grid gap-1.5">
            <label htmlFor={id} className="text-meta font-medium text-text-secondary">{label}</label>
            {children}
        </div>
    );
}

/** "Cite ›" on a group's heading, with the number of sources waiting to attach on Save. */
function CiteLink({ count, label, aria, onClick }: { count: number; label: string; aria: string; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} aria-label={aria}
            className="relative inline-flex items-center gap-0.5 min-h-8 pl-2 text-sm font-medium text-link cursor-pointer rounded-md focus-ring before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']">
            {count > 0 && <span className={cx(citeClass({ square: false }), 'mr-1')}>{count}</span>}
            {label}
            <ChevronRight className="w-[15px] h-[15px] text-text-muted" aria-hidden="true" />
        </button>
    );
}

/** A picked parent family, partner or child: what was picked and a Remove. */
function PickedRow({ lead, label, sub, removeLabel, onRemove }: {
    lead?: React.ReactNode; label: React.ReactNode; sub?: React.ReactNode; removeLabel: string; onRemove: () => void;
}) {
    return (
        <div className="flex items-center gap-3 min-h-11 py-2">
            {lead}
            <span className="flex-1 min-w-0 grid gap-px">
                <span className="text-base font-semibold text-text leading-snug">{label}</span>
                {sub && <span className="text-meta text-text-muted">{sub}</span>}
            </span>
            <button type="button" onClick={onRemove}
                className="relative min-h-9 pl-2 text-sm font-medium text-link cursor-pointer rounded-md focus-ring before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']">
                {removeLabel}
            </button>
        </div>
    );
}

type T = ReturnType<typeof useTranslations<'mobileAddPerson'>>;

function nameType(t: T, type: string) {
    const key = `vtype_${type.toLowerCase()}`;
    return t.has(key as Parameters<T>[0]) ? t(key as Parameters<T>[0]) : type;
}

const familyName = (f: { husbandName: string | null; wifeName: string | null }, t: T) =>
    [f.husbandName, f.wifeName].filter(Boolean).join(' & ') || t('unknown_family');

const familySub = (f: { MarriageDate?: string | null; marriageDate?: string | null; childCount?: number }, t: T) => [
    (f.MarriageDate ?? f.marriageDate) ? t('married_year', { year: formatYearOrEmpty(f.MarriageDate ?? f.marriageDate) }) : null,
    f.childCount != null ? t('children_count', { count: f.childCount }) : null,
].filter(Boolean).join(' · ');

const draftName = (d: NewPersonDraft, t: T) => [d.firstName, d.lastName].filter(Boolean).join(' ') || t('unnamed');

/* ── Duplicates ──────────────────────────────────────────────────────────── */

/** "Already in your tree?" Rows open the match in a new tab, so the typing here is kept. */
function Duplicates({ fm, treeId }: { fm: UsePersonForm; treeId: number | null }) {
    const t = useTranslations('mobileAddPerson');
    const matches = fm.potentialDuplicates;
    if (matches.length === 0) return null;
    return (
        <div role="status" className="rounded-[14px] bg-[color:var(--warning-bg)] px-3.5 pt-3 pb-1">
            <h4 className="m-0 text-base font-semibold text-[color:var(--warning-text)]">{t('duplicate_title')}</h4>
            <p className="m-0 mt-0.5 text-meta text-text-secondary">{t('duplicate_body', { count: matches.length })}</p>
            <div className="-mx-3.5 mt-1">
                {matches.slice(0, 3).map((p) => (
                    <a key={p.Id} href={`/people/view?id=${p.Id}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-3 min-h-11 px-3.5 py-2.5 border-t border-[color:var(--warning-text)]/20 no-underline text-text active:bg-black/5 focus-ring-inset">
                        <PersonAvatar as="span" size={36} treeId={treeId} name={displayFullName(p)} initials={getInitials(p.FirstName, p.LastName)} sex={null} />
                        <span className="flex-1 min-w-0 grid gap-px">
                            <span className="serif text-md font-semibold">{displayFullName(p)}</span>
                            {p.BirthDate && <span className="text-meta text-text-muted"><Lifespan birth={p.BirthDate} death={null} /></span>}
                        </span>
                        <ArrowUpRight className="w-[18px] h-[18px] shrink-0 text-text-muted" aria-hidden="true" />
                    </a>
                ))}
            </div>
        </div>
    );
}

/* ── Family ──────────────────────────────────────────────────────────────── */

function FamilyGroup({ fm, treeId, given, ids, onOpen }: {
    fm: UsePersonForm; treeId: number | null; given: string; ids: string; onOpen: (s: Sub) => void;
}) {
    const t = useTranslations('mobileAddPerson');
    const { form } = fm;
    const parentPicked = (fm.attachAsChild && fm.selectedFamily != null) || fm.newParent != null;
    const partnerPicked = (fm.attachAsPartner && fm.selectedSpouse != null) || fm.newSpouse != null;
    const canSuggest = form.LastName.trim() !== '' && sortableYear(form.BirthDate) != null;
    // A suggestion already taken moves down into Parents or Partner.
    const suggestions = fm.visibleSuggestions.filter((s) => s.role === 'child'
        ? !(fm.attachAsChild && fm.selectedFamily?.Id === s.familyId)
        : !(fm.attachAsPartner && fm.selectedSpouse?.Id === s.personId));

    const takeSuggestion = (s: FamilySuggestion) => {
        if (s.role === 'child') {
            fm.setNewParent(null);
            fm.setSelectedFamily({ Id: s.familyId!, Partner1Id: null, Partner2Id: null, MarriageDate: s.marriageDate, husbandName: s.husbandName, wifeName: s.wifeName, childCount: s.childCount ?? 0 });
            fm.setAttachAsChild(true);
        } else {
            fm.setNewSpouse(null);
            fm.setSelectedSpouse({ Id: s.personId!, FirstName: s.personFirstName, LastName: s.personLastName, EffectiveFirstName: s.personEffectiveFirstName, Nickname: s.personNickname, Sex: null, BirthDate: s.personBirthDate, DeathDate: null });
            fm.setAttachAsPartner(true);
        }
    };
    const removeParents = () => { fm.setSelectedFamily(null); fm.setAttachAsChild(false); fm.setNewParent(null); fm.setChildRelationshipType('Birth'); };
    const removePartner = () => {
        fm.setSelectedSpouse(null); fm.setAttachAsPartner(false); fm.setNewSpouse(null);
        fm.setMarriageDate(''); fm.setMarriagePlace(''); fm.setMarriagePlaceResolution(undefined);
    };
    const partnerName = fm.newSpouse ? draftName(fm.newSpouse, t) : fm.selectedSpouse ? displayFullName(fm.selectedSpouse) || t('unnamed') : null;
    const partnerFirst = fm.newSpouse ? (fm.newSpouse.firstName || partnerName) : fm.selectedSpouse ? (fm.selectedSpouse.FirstName?.trim().split(/\s+/)[0] || partnerName) : null;

    return (
        <section className="pt-4 border-t border-border">
            {(suggestions.length > 0 || !canSuggest) && !(parentPicked && partnerPicked) && (
                <div className="pb-3">
                    <h3 className="eyebrow m-0">{t('likely_family')}</h3>
                    {suggestions.length > 0 ? (
                        <div className="-mx-4 mt-1">
                            {suggestions.map((s, i) => (
                                <MobileRow
                                    key={`${s.role}-${s.familyId ?? s.personId}`}
                                    divided={i > 0}
                                    suggestion
                                    label={s.role === 'child'
                                        ? t('child_of', { family: familyName(s, t) })
                                        : t('partner_of', { name: s.personName || [s.personFirstName, s.personLastName].filter(Boolean).join(' ') || t('unnamed') })}
                                    sub={s.role === 'child' ? familySub(s, t) || undefined : s.personBirthDate ? t('born_year', { year: formatYearOrEmpty(s.personBirthDate) }) : undefined}
                                    onClick={() => takeSuggestion(s)}
                                />
                            ))}
                        </div>
                    ) : (
                        <p className="m-0 mt-1.5 text-meta text-text-muted">{t('likely_hint')}</p>
                    )}
                </div>
            )}

            <div className="grid gap-1 pb-3">
                <h3 className="eyebrow m-0 pt-1">{t('parents')}</h3>
                {parentPicked ? (
                    <>
                        {fm.newParent
                            ? <PickedRow label={draftName(fm.newParent, t)} sub={t('new_badge')} removeLabel={t('remove')} onRemove={removeParents} />
                            : <PickedRow label={familyName(fm.selectedFamily!, t)} sub={familySub(fm.selectedFamily!, t) || undefined} removeLabel={t('remove')} onRemove={removeParents} />}
                        <SegmentedControl aria-label={t('relationship')} fullWidth value={fm.childRelationshipType}
                            onChange={(v) => fm.setChildRelationshipType(v as ChildRelationshipType)}
                            options={PARENT_TYPES.map((v) => ({ v, l: t(`rel_${v.toLowerCase()}` as 'rel_birth') }))} />
                    </>
                ) : (
                    <div className="-mx-4">
                        <MobileRow icon={<Plus />} end="chevron" label={t('find_parents')} onClick={() => onOpen('parents')} />
                    </div>
                )}
            </div>

            <div className="grid gap-1 pb-3 border-t border-border pt-3">
                <h3 className="eyebrow m-0">{t('partner')}</h3>
                {partnerPicked ? (
                    <div className="grid gap-2.5">
                        {fm.newSpouse
                            ? <PickedRow label={partnerName} sub={t('new_badge')} removeLabel={t('remove')} onRemove={removePartner} />
                            : <PickedRow
                                lead={<PersonAvatar as="span" size={36} treeId={treeId} name={partnerName ?? ''} initials={getInitials(fm.selectedSpouse!.FirstName, fm.selectedSpouse!.LastName)} sex={fm.selectedSpouse!.Sex} />}
                                label={partnerName}
                                sub={fm.selectedSpouse!.BirthDate || fm.selectedSpouse!.DeathDate ? <Lifespan birth={fm.selectedSpouse!.BirthDate} death={fm.selectedSpouse!.DeathDate} /> : undefined}
                                removeLabel={t('remove')} onRemove={removePartner} />}
                        <Field id={`${ids}-mdate`} label={t('married')}>
                            <DateInput id={`${ids}-mdate`} value={fm.marriageDate} onChange={fm.setMarriageDate} touch className={FIELD} />
                        </Field>
                        <Field id={`${ids}-mplace`} label={t('where')}>
                            <LocationField id={`${ids}-mplace`} value={fm.marriagePlace} onChange={fm.setMarriagePlace}
                                onResolve={fm.setMarriagePlaceResolution} onRemove={() => fm.setMarriagePlaceResolution(null)}
                                placeId={fm.placeIds.marriage} onPlaceIdChange={(id) => fm.setPlaceId('marriage', id)} variant="sheet" label={t('where')}
                                treeId={treeId} className={FIELD} placeholder={t('place_placeholder')} />
                        </Field>
                    </div>
                ) : (
                    <div className="-mx-4">
                        <MobileRow icon={<Plus />} end="chevron" label={t('find_partner')} onClick={() => onOpen('partner')} />
                    </div>
                )}
            </div>

            <div className="grid gap-1 pb-4 border-t border-border pt-3">
                <h3 className="eyebrow m-0">{fm.children.length > 0 ? t('children_n', { count: fm.children.length }) : t('children')}</h3>
                {fm.children.map((c, i) => (
                    <PickedRow
                        key={c.kind === 'existing' ? c.person.Id : `new-${i}`}
                        lead={c.kind === 'existing'
                            ? <PersonAvatar as="span" size={36} treeId={treeId} name={displayFullName(c.person)} initials={getInitials(c.person.FirstName, c.person.LastName)} sex={c.person.Sex} mediaId={c.person.PrimaryMediaId} />
                            : undefined}
                        label={c.kind === 'existing' ? displayFullName(c.person) || t('unnamed') : draftName(c.draft, t)}
                        sub={c.kind === 'new' ? t('new_badge') : c.person.BirthDate || c.person.DeathDate ? <Lifespan birth={c.person.BirthDate} death={c.person.DeathDate} /> : undefined}
                        removeLabel={t('remove')}
                        onRemove={() => fm.setChildren(fm.children.filter((x) => x !== c))}
                    />
                ))}
                {fm.children.length > 0 && (
                    <p className="m-0 pb-1 text-meta text-text-muted">
                        {partnerFirst ? t('children_hint_partner', { name: given, partner: partnerFirst }) : t('children_hint_alone')}
                    </p>
                )}
                <div className="-mx-4">
                    <MobileRow icon={<Plus />} end="chevron" label={fm.children.length > 0 ? t('add_more_children') : t('add_children')} onClick={() => onOpen('children')} />
                </div>
            </div>
        </section>
    );
}

/* ── Another name ────────────────────────────────────────────────────────── */

function NameStep({ open, onClose, fm, variantId, given }: { open: boolean; onClose: () => void; fm: UsePersonForm; variantId: number | null; given: string }) {
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) { setWasOpen(open); if (open) setOpened((n) => n + 1); }
    return <NameStepBody key={opened} open={open} onClose={onClose} fm={fm} variantId={variantId} given={given} />;
}

function NameStepBody({ open, onClose, fm, variantId, given }: { open: boolean; onClose: () => void; fm: UsePersonForm; variantId: number | null; given: string }) {
    const t = useTranslations('mobileAddPerson');
    const ids = useId();
    const variant = variantId != null ? fm.variants.find((v) => v.Id === variantId) ?? null : null;
    const saved = { name: variant?.Name ?? '', type: variant?.Type ?? 'Nickname', primary: !!variant?.IsPrimary };
    const [draft, setDraft] = useState(saved);
    // A first nickname becomes the shown first name unless they say otherwise (#436,
    // ADR 0001), so a new name's switch follows its type until it's touched. Only what
    // was typed or touched counts as a change: an untouched new name closes at once.
    const [primaryTouched, setPrimaryTouched] = useState(false);
    const autoPrimary = !variant && !primaryTouched && draft.type === 'Nickname' && !fm.variants.some((v) => v.IsPrimary);
    const primary = primaryTouched || variant ? draft.primary : autoPrimary;
    const dirty = draft.name.trim() !== saved.name.trim() || draft.type !== saved.type || (primaryTouched && primary !== saved.primary);

    const done = () => {
        if (!draft.name.trim()) return;
        fm.stageVariant({ Id: variant?.Id, Type: draft.type, Name: draft.name, IsPrimary: primary });
        onClose();
    };

    return (
        <Sheet open={open} onClose={onClose} title={variant ? t('name_title_edit') : t('name_title_add')} size="full" dirty={dirty} onBack={onClose}
            onSave={done} saveLabel={variant ? t('done') : t('add')} saveDisabled={!draft.name.trim()}>
            <div className="grid gap-3 pb-3">
                <div role="group" aria-labelledby={`${ids}-type`} className="grid gap-1.5">
                    <span id={`${ids}-type`} className="text-meta font-medium text-text-secondary">{t('name_type')}</span>
                    <div className="flex flex-wrap gap-1.5">
                        {NAME_TYPES.map((type) => (
                            <FilterChip key={type} active={draft.type === type} label={nameType(t, type)} aria-pressed={draft.type === type}
                                onClick={() => setDraft((d) => ({ ...d, type }))}
                                className="!h-[34px] px-3.5 relative before:absolute before:-inset-[5px] before:content-['']" />
                        ))}
                    </div>
                </div>
                <Field id={`${ids}-name`} label={t('name_field')}>
                    <input id={`${ids}-name`} type="text" value={draft.name} maxLength={200} autoComplete="off" enterKeyHint="done"
                        placeholder={t('name_placeholder')} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className={FIELD} />
                </Field>
            </div>
            <div className="border-t border-border">
                <button type="button" role="switch" aria-checked={primary}
                    onClick={() => { setPrimaryTouched(true); setDraft((d) => ({ ...d, primary: !primary })); }}
                    className="flex w-full min-h-11 items-center gap-3 py-3 text-left cursor-pointer active:bg-surface-2 focus-ring-inset">
                    <span className="flex-1 min-w-0 grid gap-px">
                        <span className="text-base font-semibold text-text">{t('show_as_first')}</span>
                        <span className="text-meta text-text-muted">{t('show_as_first_sub', { name: given })}</span>
                    </span>
                    <span aria-hidden="true" className={cx('relative w-11 h-[26px] shrink-0 rounded-full transition-colors', primary ? 'bg-text' : 'bg-surface-2 border border-border')}>
                        <span className={cx('absolute top-[3px] w-5 h-5 rounded-full bg-card shadow transition-[left]', primary ? 'left-[21px]' : 'left-[3px]')} />
                    </span>
                </button>
            </div>
            {variant && (
                <div className="-mx-4 border-t border-border mt-2">
                    <MobileRow icon={<Trash2 />} tone="danger" label={t('remove_name')}
                        onClick={() => { void fm.removeNameVariant(variant.Id); onClose(); }} />
                </div>
            )}
        </Sheet>
    );
}

/* ── Their parents ───────────────────────────────────────────────────────── */

function ParentsStep({ open, onClose, fm, given }: { open: boolean; onClose: () => void; fm: UsePersonForm; given: string }) {
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) { setWasOpen(open); if (open) setOpened((n) => n + 1); }
    return <ParentsStepBody key={opened} open={open} onClose={onClose} fm={fm} given={given} />;
}

/**
 * The family they were born or adopted into, searched by surname or year as today,
 * with likely families first. "Create a new person" makes a parent who isn't in the
 * tree yet; on Save they get a family of their own with this person as their child.
 */
function ParentsStepBody({ open, onClose, fm, given }: { open: boolean; onClose: () => void; fm: UsePersonForm; given: string }) {
    const t = useTranslations('mobileAddPerson');
    const tp = useTranslations('personPicker');
    const tc = useTranslations('common');
    const [creating, setCreating] = useState(false);
    const [draft, setDraft] = useState<DraftFields>(EMPTY_DRAFT);
    const [bornError, setBornError] = useState(false);
    const { familySearchQuery: query, setFamilySearchQuery: setQuery } = fm;
    const typed = query.trim();

    // The query lives in the form, which keeps it between visits; each visit starts empty.
    useEffect(() => { setQuery(''); }, [setQuery]);

    const pickFamily = (f: FamilySearchResult) => {
        fm.setNewParent(null);
        fm.setSelectedFamily(f);
        fm.setAttachAsChild(true);
        onClose();
    };

    if (creating) {
        const touched = draft.firstName.trim() !== '' || draft.lastName.trim() !== '' || draft.sex !== '' || draft.born.trim() !== '';
        return (
            <Sheet open={open} onClose={onClose} title={tp('new_person')} size="full" dirty={touched}
                onBack={() => setCreating(false)} onSave={() => {
                    const made = toNewPerson(draft);
                    if (!made) { setBornError(true); return; }
                    fm.setSelectedFamily(null);
                    fm.setAttachAsChild(false);
                    fm.setNewParent(made);
                    onClose();
                }}
                saveLabel={tc('add')} saveDisabled={!draft.firstName.trim() && !draft.lastName.trim()}>
                <ShortPersonForm value={draft} bornError={bornError} hint={t('create_parent_hint', { name: given })}
                    onChange={(next) => { setDraft(next); if (next.born !== draft.born) setBornError(false); }} />
            </Sheet>
        );
    }

    const likely: FamilySearchResult[] = fm.visibleSuggestions.filter((s) => s.role === 'child' && s.familyId != null).map((s) => ({
        Id: s.familyId!, Partner1Id: null, Partner2Id: null, MarriageDate: s.marriageDate, husbandName: s.husbandName, wifeName: s.wifeName, childCount: s.childCount ?? 0,
    }));
    const shown = typed.length >= 2 ? fm.familySearchResults : likely;

    return (
        <Sheet open={open} onClose={onClose} onBack={onClose} backKeepsChanges title={t('parents_title')} size="full">
            <div className="relative">
                <Search className="absolute left-3 top-[13px] w-[18px] h-[18px] text-text-muted pointer-events-none" aria-hidden="true" />
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search_families')}
                    aria-label={t('search_families')} autoComplete="off"
                    className="w-full min-h-11 rounded-xl border border-border bg-surface pl-[38px] pr-3 text-md text-text placeholder:text-text-muted input-nozoom focus-ring" />
            </div>
            <div className="-mx-4 mt-2" aria-live="polite">
                <MobileRow icon={<Plus />} end="chevron" label={tp('create_new')} onClick={() => {
                    setDraft({ ...EMPTY_DRAFT, lastName: fm.form.LastName.trim() });
                    setBornError(false);
                    setCreating(true);
                }} />
                {!typed && likely.length > 0 && <div className="eyebrow px-4 pt-4 pb-1">{t('likely_family')}</div>}
                {shown.map((f, i) => (
                    <MobileRow key={f.Id} divided={i > 0 || typed.length >= 2} label={familyName(f, t)} sub={familySub(f, t) || undefined} onClick={() => pickFamily(f)} />
                ))}
                {typed.length >= 2 && shown.length === 0 && <p className="m-0 px-4 py-4 text-base text-text-muted">{t('no_families', { query: typed })}</p>}
                {typed.length === 1 && <p className="m-0 px-4 py-4 text-base text-text-muted">{tp('type_more')}</p>}
                {!typed && <p className="m-0 px-4 pt-3.5 text-meta text-text-muted">{t('parents_hint')}</p>}
            </div>
        </Sheet>
    );
}

/* ── Partner and children ────────────────────────────────────────────────── */

function PartnerStep({ open, onClose, fm, treeId, given }: { open: boolean; onClose: () => void; fm: UsePersonForm; treeId: number | null; given: string }) {
    const t = useTranslations('mobileAddPerson');
    const suggested: PersonResult[] = fm.visibleSuggestions.filter((s) => s.role === 'spouse' && s.personId != null).map((s) => ({
        Id: s.personId!, FirstName: s.personFirstName, LastName: s.personLastName, EffectiveFirstName: s.personEffectiveFirstName,
        Nickname: s.personNickname, Sex: null, BirthDate: s.personBirthDate, DeathDate: null,
    }));
    const pick = (picked: PickedPerson[]) => {
        const p = picked[0];
        if (!p) return;
        if (p.kind === 'existing') { fm.setNewSpouse(null); fm.setSelectedSpouse(p.person); } else { fm.setSelectedSpouse(null); fm.setNewSpouse(p.draft); }
        fm.setAttachAsPartner(true);
        onClose();
    };
    return (
        <PersonPickerSheet
            open={open}
            onClose={onClose}
            onBack={onClose}
            title={t('partner')}
            treeId={treeId}
            excludeIds={fm.children.flatMap((c) => (c.kind === 'existing' ? [c.person.Id] : []))}
            suggested={suggested.length > 0 ? { label: t('likely_family'), people: suggested } : undefined}
            onPick={pick}
            allowCreate
            createHint={t('create_partner_hint', { name: given })}
        />
    );
}

function ChildrenStep({ open, onClose, fm, treeId, given }: { open: boolean; onClose: () => void; fm: UsePersonForm; treeId: number | null; given: string }) {
    const t = useTranslations('mobileAddPerson');
    // Suggestions come from the tree's people list, the people page's own cached copy.
    const pool = useCachedResource(open ? peopleListKey(treeId) : null, async () => {
        const client = await getDataClient();
        return client.people.list({ treeId });
    });
    const partner = fm.newSpouse ? null : fm.selectedSpouse;
    const partnerName = partner ? displayFullName(partner) : '';
    const partnerFirst = partner?.FirstName?.trim().split(/\s+/)[0] || partnerName;
    const surname = fm.form.LastName.trim();
    const base = sortableYear(fm.form.BirthDate);
    const span = base != null ? { from: base + CHILD_WINDOW.from, to: base + CHILD_WINDOW.to } : null;
    const taken = new Set([
        ...fm.children.flatMap((c) => (c.kind === 'existing' ? [c.person.Id] : [])),
        ...(partner ? [partner.Id] : []),
    ]);
    const norm = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase();
    const candidates: PersonResult[] = (pool.data?.people ?? []).map((p) => ({
        Id: p.Id, FirstName: p.FirstName, LastName: p.LastName, Sex: p.Sex, BirthDate: p.BirthDate, DeathDate: p.DeathDate,
        PrimaryMediaId: p.PrimaryMediaId, FocalX: p.FocalX, FocalY: p.FocalY, FocalRadius: p.FocalRadius,
        ParentName1: p.FatherName ?? null, ParentName2: p.MotherName ?? null,
    }));
    // The partner's children (by their parent's name in the list), then the same surname
    // born 16 to 50 years after this person.
    const partnersChild = (c: PersonResult) => partnerName !== '' && (norm(c.ParentName1) === norm(partnerName) || norm(c.ParentName2) === norm(partnerName));
    const fits = (c: PersonResult) => {
        if (taken.has(c.Id)) return false;
        if (partnersChild(c)) return true;
        if (!surname || norm(c.LastName) !== norm(surname)) return false;
        if (!span) return true;
        const y = sortableYear(c.BirthDate);
        return y != null && y >= span.from && y <= span.to;
    };
    const suggested = candidates.filter(fits).sort((a, b) => Number(partnersChild(b)) - Number(partnersChild(a))
        || (sortableYear(a.BirthDate) ?? 9999) - (sortableYear(b.BirthDate) ?? 9999)).slice(0, 12);
    const label = partner && span ? t('suggested_partner_window', { partner: partnerFirst, ...span })
        : partner ? t('suggested_partner', { partner: partnerFirst })
            : span ? t('suggested_window', span) : t('suggested_surname');

    return (
        <PersonPickerSheet
            open={open}
            onClose={onClose}
            onBack={onClose}
            title={t('add_children')}
            treeId={treeId}
            multiple
            excludeIds={[...taken]}
            suggested={suggested.length > 0 ? { label, people: suggested } : undefined}
            onPick={(picked) => { fm.setChildren([...fm.children, ...picked]); onClose(); }}
            allowCreate
            defaultLastName={surname || undefined}
            createHint={t('create_child_hint', { name: given })}
        />
    );
}
