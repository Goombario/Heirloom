'use client';

import React, { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FamilyType, Person, PersonGalleryMedia, PersonResult, PersonWithRelations } from '@/lib/db/schema';
import type { ChildRelationshipType } from '@/lib/data/types';
import { getDataClient } from '@/lib/data';
import { formatYearOrEmpty } from '@/lib/date-utils';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import DateInput from '@/app/components/DateInput';
import PersonAvatar from '@/app/components/PersonAvatar';
import { PersonPickerSheet, type PickedPerson } from '@/app/components/PersonPickerSheet';
import { useCachedResource } from '@/app/components/useCachedResource';
import { FilterChip, Lifespan, MobileRow, RadioRow, SegmentedControl, cx, fieldClass } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { LinkIcon, Network, Plus, Users } from '@/lib/icons';
import { peopleListKey } from '../../peopleListKey';
import { nameBarParts } from './model';
import {
    FAMILY_ROLES, childFamilyOptions, linkPlan, linkedIds, parentFamilyOptions, siblingFamilyOptions, suggestRelatives,
    type FamilyRole, type LinkChoice, type Who,
} from './familyLinks';
import type { RunChange } from './useChange';

// The child types a person picks for their own child; Guardian and Unknown are
// set from the family page (#982).
const CHILD_TYPES: ChildRelationshipType[] = ['Birth', 'Adoption', 'Foster', 'Step'];

/*
 * Add family on the phone (#1050, tracking #1054): Parent, Partner, Child or Sibling,
 * then the shared person picker (#1059) with suggestions and "Create a new person",
 * then one confirm step that says what will happen and asks the one thing that
 * matters for the role. Add links them; Undo takes back the link and, for someone
 * created here, the person too.
 */

/** What opened the sheet: the chooser, or one role straight away (the empty-state rows). */
export interface AddFamilyFlow {
    role: FamilyRole | null;
}

/** The partnership types the family editor offers, in its order. */
const PARTNERSHIP_TYPES: { v: FamilyType; key: 'marriage' | 'civil_union' | 'common_law' | 'other' | 'unknown' }[] = [
    { v: 'Marriage', key: 'marriage' },
    { v: 'Civil union', key: 'civil_union' },
    { v: 'Common-law', key: 'common_law' },
    { v: 'Other', key: 'other' },
    { v: 'Unknown', key: 'unknown' },
];

const ROLE_ICONS: Record<FamilyRole, React.ReactNode> = {
    parent: <Network />,
    partner: <Users />,
    child: <Plus />,
    sibling: <Users />,
};

type Step =
    | { step: 'choose' }
    | { step: 'pick'; role: FamilyRole }
    | { step: 'confirm'; role: FamilyRole; picked: PickedPerson };

export interface AddFamilySheetProps {
    flow: AddFamilyFlow | null;
    onClose: () => void;
    person: PersonWithRelations;
    /** This person's portrait, for the confirm step's pair. */
    portrait?: PersonGalleryMedia;
    treeId: number | null;
    /** Editors can take back a half-done link; contributors can't revert (#1054 Roles). */
    canUndo: boolean;
    run: RunChange;
}

export function AddFamilySheet(props: AddFamilySheetProps) {
    // A fresh flow starts a fresh sheet; the last one stays mounted while it closes.
    const [prev, setPrev] = useState<AddFamilyFlow | null>(null);
    const [shown, setShown] = useState<{ flow: AddFamilyFlow; n: number } | null>(null);
    if (props.flow !== prev) {
        setPrev(props.flow);
        const next = props.flow;
        if (next) setShown((s) => ({ flow: next, n: (s?.n ?? 0) + 1 }));
    }
    if (!shown) return null;
    return <AddFamilyBody key={shown.n} {...props} open={props.flow != null} flow={shown.flow} />;
}

function AddFamilyBody({ open, flow, onClose, person, portrait, treeId, canUndo, run }: Omit<AddFamilySheetProps, 'flow'> & { open: boolean; flow: AddFamilyFlow }) {
    const t = useTranslations('mobileFamily');
    const ids = useId();
    const [step, setStep] = useState<Step>(() => (flow.role ? { step: 'pick', role: flow.role } : { step: 'choose' }));
    const [choice, setChoice] = useState<LinkChoice>({ familyId: null });
    const [showStart, setShowStart] = useState(false);
    const [busy, setBusy] = useState(false);
    const partnerRef = useRef<HTMLDivElement>(null);
    const name = nameBarParts(person).given || t('this_person');

    // Suggestions come from the tree's people list, the people page's own cached copy.
    const pool = useCachedResource(step.step === 'pick' ? peopleListKey(treeId) : null, async () => {
        const client = await getDataClient();
        return client.people.list({ treeId });
    });

    const pick = (next: FamilyRole) => setStep({ step: 'pick', role: next });

    const confirm = (picked: PickedPerson) => {
        if (step.step !== 'pick') return;
        const r = step.role;
        const first = r === 'parent' ? parentFamilyOptions(person)[0]
            : r === 'child' ? childFamilyOptions(person)[0]
                : r === 'sibling' ? siblingFamilyOptions(person)[0] : undefined;
        setChoice({
            familyId: first?.familyId ?? null,
            slot: r === 'parent' ? parentFamilyOptions(person)[0]?.slot : r === 'child' ? childFamilyOptions(person)[0]?.slot : undefined,
            childType: 'Birth',
            familyType: 'Marriage',
            startDate: null,
        });
        setShowStart(false);
        setStep({ step: 'confirm', role: r, picked });
    };

    async function add() {
        if (step.step !== 'confirm' || busy) return;
        const { picked, role: r } = step;
        const plan = linkPlan(r, person.Id, choice);
        const shownName = picked.kind === 'existing'
            ? displayFullName(picked.person) || t('unknown')
            : [picked.draft.firstName, picked.draft.lastName].filter(Boolean).join(' ') || t('unknown');
        const sex = (picked.kind === 'existing' ? picked.person.Sex : picked.draft.sex) ?? 'U';
        setBusy(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            const auditIds: number[] = [];
            try {
                let pickedId: number;
                if (picked.kind === 'existing') {
                    pickedId = picked.person.Id;
                } else {
                    const d = picked.draft;
                    const created = await client.people.create({
                        FirstName: d.firstName || null, LastName: d.lastName || null, Sex: d.sex, BirthDate: d.birthDate,
                    }, { treeId });
                    auditIds.push(...created.auditIds);
                    pickedId = created.Id;
                }
                const who = (w: Who | null) => (w === 'picked' ? pickedId : w);
                let newFamily: number | null = null;
                for (const s of plan) {
                    if (s.kind === 'create-family') {
                        const f = await client.families.create({
                            Partner1Id: who(s.partners[0]), Partner2Id: who(s.partners[1]),
                            ...(s.type ? { Type: s.type } : {}),
                            ...(s.startDate ? { MarriageDate: s.startDate } : {}),
                        }, treeId);
                        auditIds.push(...f.auditIds);
                        newFamily = f.Id;
                    } else if (s.kind === 'set-partner') {
                        const f = await client.families.update(s.familyId, { [s.slot]: pickedId }, treeId);
                        auditIds.push(...f.auditIds);
                    } else {
                        const familyId = s.familyId === 'new' ? newFamily : s.familyId;
                        if (familyId == null) throw new Error('No family to join');
                        const r2 = await client.families.addChild(familyId, who(s.child) as number, s.type, treeId);
                        auditIds.push(...r2.auditIds);
                    }
                }
            } catch (e) {
                // Leave nothing half-linked: take back what went through, then report.
                if (canUndo && auditIds.length > 0) {
                    try { await client.audit.revert(auditIds, treeId); } catch { /* the error below is the one to show */ }
                }
                throw e;
            }
            return { auditIds };
        }, { message: t(`added_${r}`, { name: shownName, of: name, sex, married: choice.familyType === 'Marriage' ? 'yes' : 'no' }) });
        setBusy(false);
        if (ok) onClose();
    }

    /* ── Chooser ── */

    if (step.step === 'choose') {
        return (
            <Sheet open={open} onClose={onClose} title={t('add_family')}>
                <p className="m-0 pb-1 text-base text-text-secondary">{t('who_adding', { name })}</p>
                <div className="-mx-4">
                    {FAMILY_ROLES.map((r, i) => (
                        <MobileRow key={r} divided={i > 0} icon={ROLE_ICONS[r]} label={t(`role_${r}`)} end="chevron" onClick={() => pick(r)} />
                    ))}
                </div>
            </Sheet>
        );
    }

    /* ── Person picker ── */

    if (step.step === 'pick') {
        const r = step.role;
        const candidates: PersonResult[] = (pool.data?.people ?? []).map((p) => ({
            Id: p.Id, FirstName: p.FirstName, LastName: p.LastName, Sex: p.Sex, BirthDate: p.BirthDate, DeathDate: p.DeathDate,
            PrimaryMediaId: p.PrimaryMediaId,
            FocalX: p.FocalX, FocalY: p.FocalY, FocalRadius: p.FocalRadius,
            ParentName1: p.FatherName ?? null, ParentName2: p.MotherName ?? null,
        }));
        const s = suggestRelatives(r, person, candidates);
        const label = s.surname && s.window ? t('suggested_surname_window', { surname: s.surname, ...s.window })
            : s.surname ? t('suggested_surname', { surname: s.surname })
                : s.window ? t('suggested_window', s.window) : t('suggested');
        return (
            <PersonPickerSheet
                open={open}
                onClose={onClose}
                onBack={flow.role ? undefined : () => setStep({ step: 'choose' })}
                title={t(`title_${r}`)}
                treeId={treeId}
                excludeIds={linkedIds(person)}
                suggested={s.people.length > 0 ? { label, people: s.people } : undefined}
                onPick={(picked) => { if (picked[0]) confirm(picked[0]); }}
                allowCreate
                defaultLastName={r === 'partner' ? undefined : person.LastName ?? undefined}
                createHint={t('create_hint', { name })}
            />
        );
    }

    /* ── Confirm ── */

    const { picked } = step;
    const r = step.role;
    const pickedName = picked.kind === 'existing'
        ? displayFullName(picked.person) || t('unknown')
        : [picked.draft.firstName, picked.draft.lastName].filter(Boolean).join(' ') || t('unknown');
    const sex = (picked.kind === 'existing' ? picked.person.Sex : picked.draft.sex) ?? 'U';
    const married = choice.familyType === 'Marriage' ? 'yes' : 'no';
    const set = (patch: Partial<LinkChoice>) => setChoice((c) => ({ ...c, ...patch }));
    const first = (p: Person | null | undefined) => (p ? p.FirstName?.trim().split(/\s+/)[0] || displayFullName(p) || t('unknown') : t('unknown'));

    return (
        <Sheet
            open={open}
            onClose={onClose}
            onBack={() => setStep({ step: 'pick', role: r })}
            title={t(`title_${r}`)}
            size="full"
            // A person typed into the short form would be lost going back.
            dirty={picked.kind === 'new'}
            onSave={add}
            saveLabel={t('add')}
            saveWhenClean
            saveDisabled={busy}
        >
            <div className="flex items-center justify-center gap-3 pt-5 pb-2.5" aria-hidden="true">
                <PersonAvatar as="span" size={56} treeId={treeId} name={displayFullName(person)} initials={getInitials(person.FirstName, person.LastName)} sex={person.Sex}
                    mediaId={portrait?.Id} focalX={portrait?.FocalX} focalY={portrait?.FocalY} />
                <LinkIcon className="w-[18px] h-[18px] text-text-muted" />
                {picked.kind === 'existing'
                    ? <PersonAvatar as="span" size={56} treeId={treeId} name={pickedName} initials={getInitials(picked.person.FirstName, picked.person.LastName)} sex={picked.person.Sex}
                        mediaId={picked.person.PrimaryMediaId} focalX={picked.person.FocalX} focalY={picked.person.FocalY} focalRadius={picked.person.FocalRadius} />
                    : <PersonAvatar as="span" size={56} name={pickedName} initials={getInitials(picked.draft.firstName, picked.draft.lastName)} sex={picked.draft.sex} />}
            </div>
            <p className="m-0 mb-2 text-center text-md leading-normal text-text-secondary text-balance">
                {t.rich(`becomes_${r}`, {
                    name: pickedName, of: name, sex, married,
                    b: (chunks) => <b className="font-semibold text-text">{chunks}</b>,
                    meta: () => picked.kind === 'existing'
                        ? (picked.person.BirthDate || picked.person.DeathDate ? <> (<Lifespan birth={picked.person.BirthDate} death={picked.person.DeathDate} />)</> : null)
                        : <> ({t('new_person')})</>,
                })}
            </p>

            {r === 'partner' && (
                <div ref={partnerRef}>
                    <Group title={t('partnership')}>
                        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('partnership')}>
                            {PARTNERSHIP_TYPES.map((x) => (
                                <FilterChip key={x.v} active={choice.familyType === x.v} onClick={() => set({ familyType: x.v })}
                                    className="relative !h-[34px] before:absolute before:-inset-y-[5px] before:inset-x-0 before:content-['']">
                                    {t(`ftype_${x.key}`)}
                                </FilterChip>
                            ))}
                        </div>
                    </Group>
                    {showStart ? (
                        <div className="grid gap-1.5 pt-3">
                            <label htmlFor={`${ids}-start`} className="text-meta font-medium text-text-secondary">{married === 'yes' ? t('married') : t('started')}</label>
                            <DateInput id={`${ids}-start`} value={choice.startDate ?? ''} onChange={(startDate) => set({ startDate: startDate || null })} qualifierChips className={cx(fieldClass(), 'min-h-11')} />
                        </div>
                    ) : (
                        <div className="-mx-4 mt-2 border-t border-border">
                            <MobileRow icon={<Plus />} end="chevron" label={t('add_start')} onClick={() => {
                                setShowStart(true);
                                // DateInput owns its input, so focus goes by id inside the group.
                                requestAnimationFrame(() => partnerRef.current?.querySelector<HTMLElement>(`[id="${ids}-start"]`)?.focus());
                            }} />
                        </div>
                    )}
                </div>
            )}

            {r === 'parent' && (
                <Group title={t('birth_family', { name })}>
                    <Radios label={t('birth_family', { name })} value={choice.familyId} onChange={(familyId) => set({ familyId, slot: parentFamilyOptions(person).find((o) => o.familyId === familyId)?.slot })}
                        options={[
                            ...parentFamilyOptions(person).map((o) => ({
                                value: o.familyId,
                                label: o.parent ? t('parent_family', { parent: first(o.parent) }) : t('family_no_parents'),
                                hint: [
                                    o.relationshipType === 'Adoption' || o.relationshipType === 'Foster' || o.relationshipType === 'Step' ? t(`kind_${o.relationshipType}`) : null,
                                    o.parent ? t('parent_family_sub', { parent: first(o.parent), name }) : null,
                                ].filter(Boolean).join(' · ') || undefined,
                            })),
                            { value: null, label: t('new_family'), hint: t('new_family_parent_sub', { name }) },
                        ]} />
                </Group>
            )}

            {r === 'child' && (
                <>
                    <Group title={t('which_family')}>
                        <Radios label={t('which_family')} value={choice.familyId} onChange={(familyId) => set({ familyId, slot: childFamilyOptions(person).find((o) => o.familyId === familyId)?.slot })}
                            options={[
                                ...childFamilyOptions(person).map((o) => ({
                                    value: o.familyId,
                                    label: o.partner ? t('with_partner', { name: first(o.partner) }) : t('only', { name }),
                                    hint: o.marriageDate
                                        ? t('married_children', { year: formatYearOrEmpty(o.marriageDate), count: o.childCount })
                                        : t('children_count', { count: o.childCount }),
                                })),
                                // One family with the other parent unknown is enough.
                                ...(childFamilyOptions(person).some((o) => !o.partner) ? [] : [{ value: null, label: t('only', { name }), hint: t('only_new_sub') }]),
                            ]} />
                    </Group>
                    <Group title={t('relationship')}>
                        <SegmentedControl aria-label={t('relationship')} fullWidth value={choice.childType ?? 'Birth'}
                            onChange={(v) => set({ childType: v as ChildRelationshipType })}
                            options={CHILD_TYPES.map((v) => ({ v, l: t(`child_type_${v}`) }))} />
                    </Group>
                </>
            )}

            {r === 'sibling' && (
                <Group title={t('which_family')}>
                    <Radios label={t('which_family')} value={choice.familyId} onChange={(familyId) => set({ familyId })}
                        options={siblingFamilyOptions(person).length > 0
                            ? siblingFamilyOptions(person).map((o) => ({
                                value: o.familyId,
                                label: o.parents.length > 0 ? t('children_of', { names: o.parents.map(first).join(' & ') }) : t('parents_unknown'),
                                hint: t('children_count', { count: o.childCount }),
                            }))
                            : [{ value: null, label: t('new_family'), hint: t('new_family_sibling_sub', { name }) }]} />
                    <p className="m-0 pt-2 text-meta text-text-muted">{t('sibling_kind_hint')}</p>
                </Group>
            )}
        </Sheet>
    );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="grid gap-2.5 pt-4 mt-2 border-t border-border">
            <div className="eyebrow" aria-hidden="true">{title}</div>
            {children}
        </div>
    );
}

function Radios<T extends number | null>({ label, value, options, onChange }: {
    label: string;
    value: T;
    options: { value: T; label: string; hint?: string }[];
    onChange: (v: T) => void;
}) {
    return (
        <div role="radiogroup" aria-label={label} className="-mx-4 -mt-1.5">
            {options.map((o, i) => (
                <RadioRow key={o.value ?? 'new'} checked={o.value === value} label={o.label} hint={o.hint} divided={i > 0} onSelect={() => onChange(o.value)} />
            ))}
        </div>
    );
}
