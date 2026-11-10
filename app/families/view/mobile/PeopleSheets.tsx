'use client';

import React, { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FamilyType, PersonResult } from '@/lib/db/schema';
import type { ChildRelationshipType } from '@/lib/data/types';
import type { Note } from '@/lib/data/types';
import { CHILD_RELATIONSHIP_TYPE_VALUES } from '@/lib/child-relationship';
import { getDataClient } from '@/lib/data';
import { formatYearOrEmpty } from '@/lib/date-utils';
import { displayFullName } from '@/lib/utils/names';
import { FamilySearch } from '@/app/components/FamilySearch';
import { PersonPickerSheet, type PickedPerson } from '@/app/components/PersonPickerSheet';
import { useCachedResource } from '@/app/components/useCachedResource';
import { Lifespan, MobileRow, RadioRow } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { ArrowLeftRight, HeartCrack, LinkIcon, Pencil, Plus, Trash2, UserMinus, Users } from '@/lib/icons';
import type { RunChange } from '@/app/people/view/mobile/useChange';
import { peopleListKey } from '@/app/people/peopleListKey';
import type { PartnerPerson } from '../useFamilyDetail';
import { partnerName, partnerShortName } from '../derive';
import { SLOT_COLUMN, childLink, coupleName, endingOf, partnersOf, suggestChildren, type PhoneFamily, type Slot } from './model';
import { ftypeKey, useChildLinkText, type FamilyRole, type OtherPartnerships } from './panes';
import { ChipGroup, Face, Group } from './parts';

/*
 * The family page's people sheets on the phone (#1062): the pencil menu, Change
 * partners, Add partner, Add child and Edit children (relationship to each partner,
 * move, remove), and Delete family. People are picked with the shared picker (#1059)
 * and every link change goes through one confirm step. Editors get Undo; contributors
 * add and relink but don't remove, move or delete (#1054 Roles).
 */

/** What opened the sheet. */
export type PeopleFlow =
    | { kind: 'menu' }
    | { kind: 'partners' }
    | { kind: 'add-partner'; slot: Slot }
    | { kind: 'add-child' }
    | { kind: 'children' }
    | { kind: 'delete' };

type Step =
    | { step: 'menu' }
    | { step: 'partners' }
    | { step: 'partner'; slot: Slot }
    | { step: 'pick-partner'; slot: Slot; from: 'partners' | 'partner' | null }
    | { step: 'confirm-partner'; slot: Slot; picked: PickedPerson; from: 'partners' | 'partner' | null }
    | { step: 'pick-children' }
    | { step: 'confirm-children'; picked: PickedPerson[] }
    | { step: 'children' }
    | { step: 'child'; childId: number; from: 'children' | null }
    | { step: 'move'; childId: number }
    | { step: 'delete'; from: Step | null };

const FAMILY_TYPES: FamilyType[] = ['Marriage', 'Civil union', 'Common-law', 'Other', 'Unknown'];

export interface PeopleSheetsProps {
    flow: PeopleFlow | null;
    onClose: () => void;
    data: PhoneFamily;
    /** Each partner's other families, the first places a child moves to. */
    others: OtherPartnerships[];
    treeId: number | null;
    role: FamilyRole;
    run: RunChange;
    /** The menu's start and end rows open the event sheets. */
    onStart: () => void;
    onEnd: () => void;
    /** Delete the family; the page owns going back and the Undo. */
    onDelete: () => Promise<boolean>;
    /** The changed row, so it flashes once. */
    onSaved: (key: string) => void;
}

export function PeopleSheets(props: PeopleSheetsProps) {
    // A fresh flow starts a fresh sheet; the last one stays mounted while it closes.
    const [prev, setPrev] = useState<PeopleFlow | null>(null);
    const [shown, setShown] = useState<{ flow: PeopleFlow; n: number } | null>(null);
    if (props.flow !== prev) {
        setPrev(props.flow);
        const next = props.flow;
        if (next) setShown((s) => ({ flow: next, n: (s?.n ?? 0) + 1 }));
    }
    if (!shown) return null;
    return <Body key={shown.n} {...props} open={props.flow != null} flow={shown.flow} />;
}

function firstStep(flow: PeopleFlow): Step {
    switch (flow.kind) {
        case 'menu': return { step: 'menu' };
        case 'partners': return { step: 'partners' };
        case 'add-partner': return { step: 'pick-partner', slot: flow.slot, from: null };
        case 'add-child': return { step: 'pick-children' };
        case 'children': return { step: 'children' };
        case 'delete': return { step: 'delete', from: null };
    }
}

/** The name a picked person goes by in the confirm step. */
function pickedName(p: PickedPerson, unknown: string): string {
    return p.kind === 'existing'
        ? displayFullName(p.person) || unknown
        : [p.draft.firstName, p.draft.lastName].filter(Boolean).join(' ') || unknown;
}

/** Create a picked new person, or return the existing one's id. */
async function idOf(p: PickedPerson, treeId: number | null, auditIds: number[]): Promise<number> {
    if (p.kind === 'existing') return p.person.Id;
    const client = await getDataClient();
    const d = p.draft;
    const created = await client.people.create({ FirstName: d.firstName || null, LastName: d.lastName || null, Sex: d.sex, BirthDate: d.birthDate }, { treeId });
    auditIds.push(...created.auditIds);
    return created.Id;
}

const ids = (r: { auditId: number | null }) => (r.auditId != null ? [r.auditId] : []);

function Body({ open, flow, onClose, data, others, treeId, role, run, onStart, onEnd, onDelete, onSaved }:
    Omit<PeopleSheetsProps, 'flow'> & { open: boolean; flow: PeopleFlow }) {
    const t = useTranslations('familyPhone');
    const tf = useTranslations('mobileFamily');
    const tp = useTranslations('mobilePerson');
    const tc = useTranslations('common');
    const linkText = useChildLinkText(data);
    const { family } = data;
    const editor = role === 'editor';
    const [step, setStep] = useState<Step>(() => firstStep(flow));
    const [busy, setBusy] = useState(false);
    const [type, setType] = useState<FamilyType>(family.Type ?? 'Marriage');
    const [links, setLinks] = useState<{ partner1: ChildRelationshipType; partner2: ChildRelationshipType }>({ partner1: 'Birth', partner2: 'Birth' });
    const [savedLinks, setSavedLinks] = useState(links);
    const [target, setTarget] = useState<string | null>(null);
    const [searching, setSearching] = useState(false);
    const [found, setFound] = useState<{ id: number; label: string } | null>(null);
    const [confirming, setConfirming] = useState(false);
    const unknown = tp('unknown');
    const first = (p: PartnerPerson | null | undefined) => (p ? partnerShortName(p) || unknown : unknown);
    const partners = partnersOf(data);
    const familyName = coupleName(data.partner1, data.partner2) || t('family');

    // Add child's suggestions come from the tree's people list, the people page's cached copy.
    const pool = useCachedResource(step.step === 'pick-children' ? peopleListKey(treeId) : null, async () => {
        const client = await getDataClient();
        return client.people.list({ treeId });
    });

    const goChild = (childId: number, from: 'children' | null) => {
        const child = data.children.find((c) => c.Id === childId);
        const l = child ? { partner1: childLink(child, 'partner1'), partner2: childLink(child, 'partner2') } : { partner1: 'Birth' as const, partner2: 'Birth' as const };
        setLinks(l); setSavedLinks(l);
        setStep({ step: 'child', childId, from });
    };

    /* ── Writes ── */

    async function setPartner(slot: Slot, picked: PickedPerson) {
        if (busy) return;
        const name = pickedName(picked, unknown);
        const old = data[slot];
        setBusy(true);
        let newId = 0;
        const ok = await run(async () => {
            const auditIds: number[] = [];
            const client = await getDataClient();
            try {
                newId = await idOf(picked, treeId, auditIds);
                const row = await client.families.update(family.Id, { [SLOT_COLUMN[slot]]: newId, ...(!old && type !== family.Type ? { Type: type } : {}) }, treeId);
                auditIds.push(...row.auditIds);
            } catch (e) {
                // Leave no one created for nothing: take back what went through.
                if (editor && auditIds.length > 0) { try { await client.audit.revert(auditIds, treeId); } catch { /* report the first error */ } }
                throw e;
            }
            return { auditIds };
        }, { message: old ? t('partner_replaced', { name, old: first(old) }) : t('partner_added', { name }) });
        setBusy(false);
        if (!ok) return;
        onSaved(`person-${newId}`);
        onClose();
    }

    async function removePartner(slot: Slot) {
        const person = data[slot];
        if (!person || busy) return;
        setBusy(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            return client.families.update(family.Id, { [SLOT_COLUMN[slot]]: null }, treeId);
        }, { message: t('partner_removed', { name: first(person) }), detail: t('stays_in_tree') });
        setBusy(false);
        setConfirming(false);
        if (ok) onClose();
    }

    async function addChildren(picked: PickedPerson[]) {
        if (busy || picked.length === 0) return;
        const relationship = partners.length === 2 ? links : partners[0]?.slot === 'partner2' ? links.partner2 : links.partner1;
        setBusy(true);
        let lastId = 0;
        const ok = await run(async () => {
            const client = await getDataClient();
            const auditIds: number[] = [];
            try {
                for (const p of picked) {
                    const id = await idOf(p, treeId, auditIds);
                    auditIds.push(...(await client.families.addChild(family.Id, id, relationship, treeId)).auditIds);
                    lastId = id;
                }
            } catch (e) {
                if (editor && auditIds.length > 0) { try { await client.audit.revert(auditIds, treeId); } catch { /* report the first error */ } }
                throw e;
            }
            return { auditIds };
        }, {
            message: picked.length === 1 ? t('child_added', { name: pickedName(picked[0], unknown) }) : t('children_added', { count: picked.length }),
        });
        setBusy(false);
        if (!ok) return;
        if (picked.length === 1) onSaved(`person-${lastId}`);
        onClose();
    }

    async function saveLinks(child: PartnerPerson) {
        if (busy) return;
        // One partner: one choice, written to both slots so it reads the same if a partner is added.
        const relationship = partners.length === 2 ? links : partners[0]?.slot === 'partner2' ? links.partner2 : links.partner1;
        setBusy(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            return client.families.updateChildType(family.Id, child.Id, relationship, treeId);
        }, { message: t('child_saved', { name: first(child) }) });
        setBusy(false);
        if (!ok) return;
        onSaved(`person-${child.Id}`);
        setSavedLinks(links);
        onClose();
    }

    async function removeChild(child: PartnerPerson) {
        if (busy) return;
        setBusy(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            return { auditIds: ids(await client.families.removeChild(family.Id, child.Id, treeId)) };
        }, { message: t('child_removed', { name: first(child) }), detail: t('stays_in_tree') });
        setBusy(false);
        setConfirming(false);
        if (ok) onClose();
    }

    async function moveChild(child: PartnerPerson, to: string, label: string) {
        if (busy) return;
        setBusy(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            const auditIds: number[] = [];
            let toId: number;
            if (to.startsWith('only-')) {
                // "Greta only": a new family with just that partner, then the move.
                const slot = to.slice(5) as Slot;
                const f = await client.families.create({ [SLOT_COLUMN[slot]]: data[slot]?.Id ?? null }, treeId);
                auditIds.push(...f.auditIds);
                toId = f.Id;
            } else {
                toId = Number(to);
            }
            auditIds.push(...ids(await client.families.moveChild(family.Id, child.Id, toId, treeId)));
            return { auditIds };
        }, { message: t('child_moved', { name: first(child) }), detail: label });
        setBusy(false);
        if (ok) onClose();
    }

    async function deleteFamily() {
        if (busy) return;
        setBusy(true);
        const ok = await onDelete();
        setBusy(false);
        setConfirming(false);
        if (ok) onClose();
    }

    /* ── Menu ── */

    if (step.step === 'menu') {
        const start = [formatYearOrEmpty(family.MarriageDate), family.MarriagePlace?.split(',')[0]?.trim()].filter(Boolean).join(' · ');
        const ending = endingOf(data);
        const endSub = ending?.kind === 'event' ? [t(`reason_${ending.reason}`), formatYearOrEmpty(ending.event.Date)].filter(Boolean).join(' · ')
            : ending?.kind === 'death' ? t('death_of', { name: first(ending.partner) }) : t('nothing_ended');
        return (
            <Sheet open={open} onClose={onClose} title={familyName}>
                <div className="-mx-4">
                    <MobileRow icon={<Pencil />} end="chevron" label={t(family.Type === 'Marriage' ? 'menu_marriage' : 'menu_start')}
                        sub={start || tp('not_recorded')} onClick={() => { onClose(); onStart(); }} />
                    <MobileRow divided icon={<HeartCrack />} end="chevron" label={t('how_it_ended')} sub={endSub} onClick={() => { onClose(); onEnd(); }} />
                    <MobileRow divided icon={<Users />} end="chevron" label={t('change_partners')}
                        sub={partners.map((p) => first(p.person)).join(' & ') || t('no_partners')} onClick={() => setStep({ step: 'partners' })} />
                    {editor && (
                        <MobileRow divided icon={<Trash2 />} tone="danger" label={t('delete_family')} sub={t('delete_family_sub')}
                            onClick={() => setStep({ step: 'delete', from: { step: 'menu' } })} />
                    )}
                </div>
            </Sheet>
        );
    }

    /* ── Delete family ── */

    if (step.step === 'delete') {
        return (
            <ConfirmSheet
                open={open}
                title={t('delete_family_title', { name: familyName })}
                body={t('delete_family_body')}
                confirmLabel={t('delete_family_pill')}
                onConfirm={deleteFamily}
                onClose={step.from ? () => setStep(step.from as Step) : onClose}
                busy={busy}
            />
        );
    }

    /* ── Change partners ── */

    if (step.step === 'partners') {
        return (
            <Sheet open={open} onClose={onClose} onBack={flow.kind === 'menu' ? () => setStep({ step: 'menu' }) : undefined} title={t('change_partners')}>
                <div className="-mx-4">
                    {(['partner1', 'partner2'] as Slot[]).map((slot, i) => {
                        const p = data[slot];
                        return p ? (
                            <MobileRow key={slot} divided={i > 0} end="chevron" lead={<Face person={p} size={36} treeId={treeId} />}
                                label={<span className="serif font-semibold text-md">{partnerName(p) || unknown}</span>}
                                sub={p.BirthDate || p.DeathDate ? <span className="font-mono"><Lifespan birth={p.BirthDate} death={p.DeathDate} /></span> : undefined}
                                onClick={() => setStep({ step: 'partner', slot })} />
                        ) : (
                            <MobileRow key={slot} divided={i > 0} icon={<Plus />} end="chevron" label={t('add_partner')}
                                onClick={() => { setType(family.Type ?? 'Marriage'); setStep({ step: 'pick-partner', slot, from: 'partners' }); }} />
                        );
                    })}
                </div>
                <p className="m-0 pt-3 pb-1 text-meta text-text-muted">{t('partners_hint')}</p>
            </Sheet>
        );
    }

    if (step.step === 'partner') {
        const p = data[step.slot];
        if (!p) return null;
        const other = data[step.slot === 'partner1' ? 'partner2' : 'partner1'];
        // Removing the last person leaves an empty family: offer to delete it instead.
        const lastOne = !other && data.children.length === 0;
        return (
            <Sheet open={open} onClose={onClose} onBack={() => setStep({ step: 'partners' })} title={partnerName(p) || unknown}>
                <div className="-mx-4">
                    <MobileRow href={`/people/view?id=${p.Id}`} end="leave" lead={<Face person={p} size={36} treeId={treeId} />}
                        label={t('open_page', { name: first(p) })} />
                    <MobileRow divided icon={<ArrowLeftRight />} end="chevron" label={t('replace_partner')} sub={t('replace_partner_sub', { name: first(p) })}
                        onClick={() => setStep({ step: 'pick-partner', slot: step.slot, from: 'partner' })} />
                    {editor && (
                        <MobileRow divided icon={<UserMinus />} tone="danger" label={t('remove_partner')}
                            sub={lastOne ? t('remove_partner_last') : t('remove_partner_sub', { name: first(p) })}
                            onClick={() => (lastOne ? setStep({ step: 'delete', from: step }) : setConfirming(true))} />
                    )}
                </div>
                <ConfirmSheet open={confirming} title={t('remove_partner_title', { name: first(p) })}
                    body={t('remove_partner_body', { name: first(p) })} confirmLabel={t('remove_pill')}
                    onConfirm={() => removePartner(step.slot)} onClose={() => setConfirming(false)} busy={busy} />
            </Sheet>
        );
    }

    if (step.step === 'pick-partner') {
        const other = data[step.slot === 'partner1' ? 'partner2' : 'partner1'];
        return (
            <PersonPickerSheet
                open={open}
                onClose={onClose}
                onBack={step.from ? () => setStep(step.from === 'partner' ? { step: 'partner', slot: step.slot } : { step: 'partners' }) : undefined}
                title={data[step.slot] ? t('replace_title', { name: first(data[step.slot]) }) : t('add_partner')}
                treeId={treeId}
                excludeIds={[data.partner1?.Id, data.partner2?.Id, ...data.children.map((c) => c.Id)].filter((x): x is number => x != null)}
                onPick={(picked) => { if (picked[0]) setStep({ step: 'confirm-partner', slot: step.slot, picked: picked[0], from: step.from }); }}
                allowCreate
                createHint={other ? t('partner_create_hint', { name: first(other) }) : undefined}
            />
        );
    }

    if (step.step === 'confirm-partner') {
        const { picked, slot } = step;
        const old = data[slot];
        const other = data[slot === 'partner1' ? 'partner2' : 'partner1'];
        const name = pickedName(picked, unknown);
        const face = picked.kind === 'existing' ? picked.person : { FirstName: picked.draft.firstName, LastName: picked.draft.lastName, Sex: picked.draft.sex };
        return (
            <Sheet open={open} onClose={onClose} onBack={() => setStep({ step: 'pick-partner', slot, from: step.from })}
                title={old ? t('replace_title', { name: first(old) }) : t('add_partner')} size="full"
                dirty={picked.kind === 'new'} onSave={() => setPartner(slot, picked)} saveLabel={old ? t('replace_pill') : tf('add')} saveWhenClean saveDisabled={busy}>
                <div className="flex items-center justify-center gap-3 pt-5 pb-2.5" aria-hidden="true">
                    {other && <Face person={other} treeId={treeId} />}
                    {other && <LinkIcon className="w-[18px] h-[18px] text-text-muted" />}
                    <Face person={face as PartnerPerson} treeId={picked.kind === 'existing' ? treeId : null} />
                </div>
                <p className="m-0 mb-2 text-center text-md leading-normal text-text-secondary text-balance">
                    {t.rich(old ? 'confirm_replace' : other ? 'confirm_partner' : 'confirm_partner_alone', {
                        name, old: old ? first(old) : '', other: other ? first(other) : '',
                        b: (chunks) => <b className="font-semibold text-text">{chunks}</b>,
                        meta: () => picked.kind === 'existing'
                            ? (picked.person.BirthDate || picked.person.DeathDate ? <> (<Lifespan birth={picked.person.BirthDate} death={picked.person.DeathDate} />)</> : null)
                            : <> ({tf('new_person')})</>,
                    })}
                </p>
                {old && <p className="m-0 mb-2 text-center text-meta text-text-muted">{t('stays_in_tree_named', { name: first(old) })}</p>}
                {!old && (
                    <Group title={tf('partnership')}>
                        <ChipGroup label={tf('partnership')} value={type} onChange={setType}
                            options={FAMILY_TYPES.map((v) => ({ v, l: tf(`ftype_${ftypeKey(v)}`) }))} />
                    </Group>
                )}
            </Sheet>
        );
    }

    /* ── Add child ── */

    if (step.step === 'pick-children') {
        const candidates: PersonResult[] = suggestChildren(data, pool.data?.people ?? []).map((p) => ({
            Id: p.Id, FirstName: p.FirstName, LastName: p.LastName, Sex: p.Sex, BirthDate: p.BirthDate, DeathDate: p.DeathDate,
            PrimaryMediaId: p.PrimaryMediaId, FocalX: p.FocalX, FocalY: p.FocalY, FocalRadius: p.FocalRadius,
            ParentName1: p.FatherName ?? null, ParentName2: p.MotherName ?? null,
        }));
        const surname = (data.partner1 ?? data.partner2)?.LastName ?? undefined;
        return (
            <PersonPickerSheet
                open={open}
                onClose={onClose}
                title={t('add_child')}
                treeId={treeId}
                multiple
                excludeIds={[data.partner1?.Id, data.partner2?.Id, ...data.children.map((c) => c.Id)].filter((x): x is number => x != null)}
                suggested={candidates.length > 0 ? { label: tf('suggested'), people: candidates } : undefined}
                onPick={(picked) => {
                    if (picked.length === 0) return;
                    setLinks({ partner1: 'Birth', partner2: 'Birth' });
                    setStep({ step: 'confirm-children', picked });
                }}
                allowCreate
                defaultLastName={surname}
                createHint={t('child_create_hint', { names: partners.map((p) => first(p.person)).join(' & ') || t('family') })}
            />
        );
    }

    if (step.step === 'confirm-children') {
        const { picked } = step;
        return (
            <Sheet open={open} onClose={onClose} onBack={() => setStep({ step: 'pick-children' })} title={t('add_child')} size="full"
                dirty={picked.some((p) => p.kind === 'new')} onSave={() => addChildren(picked)} saveLabel={tf('add')} saveWhenClean saveDisabled={busy}>
                <p className="m-0 pt-4 mb-2 text-md leading-normal text-text-secondary text-balance">
                    {t.rich('confirm_children', {
                        count: picked.length,
                        name: pickedName(picked[0], unknown),
                        names: partners.map((p) => first(p.person)).join(' & ') || t('this_family'),
                        b: (chunks) => <b className="font-semibold text-text">{chunks}</b>,
                    })}
                </p>
                {picked.length > 1 && (
                    <ul className="m-0 mb-2 p-0 list-none grid gap-1 text-base text-text">
                        {picked.map((p, i) => <li key={i}>{pickedName(p, unknown)}</li>)}
                    </ul>
                )}
                <LinkChoices partners={partners} links={links} setLinks={setLinks} count={picked.length} />
            </Sheet>
        );
    }

    /* ── Edit children ── */

    if (step.step === 'children') {
        return (
            <Sheet open={open} onClose={onClose} title={t('edit_children')}>
                <div className="-mx-4">
                    {data.children.map((k, i) => (
                        <MobileRow key={k.Id} divided={i > 0} end="chevron" lead={<Face person={k} size={36} treeId={treeId} />}
                            label={<span className="serif font-semibold text-md">{partnerName(k) || unknown}</span>}
                            sub={[formatYearOrEmpty(k.BirthDate), linkText(k)].filter(Boolean).join(' · ') || undefined}
                            onClick={() => goChild(k.Id, 'children')} />
                    ))}
                </div>
                <p className="m-0 pt-3 pb-1 text-meta text-text-muted">{t('children_hint')}</p>
            </Sheet>
        );
    }

    if (step.step === 'child') {
        const child = data.children.find((c) => c.Id === step.childId);
        if (!child) return null;
        const dirty = links.partner1 !== savedLinks.partner1 || links.partner2 !== savedLinks.partner2;
        return (
            <Sheet open={open} onClose={onClose} onBack={step.from ? () => setStep({ step: 'children' }) : undefined} backKeepsChanges={false}
                title={partnerName(child) || unknown} size="full" dirty={dirty} onSave={() => saveLinks(child)} saveDisabled={busy}>
                <LinkChoices partners={partners} links={links} setLinks={setLinks} count={1} first />
                <div className="-mx-4 mt-2 border-t border-border">
                    <MobileRow href={`/people/view?id=${child.Id}`} end="leave" lead={<Face person={child} size={36} treeId={treeId} />}
                        label={t('open_page', { name: first(child) })} />
                    {editor && (
                        <>
                            <MobileRow divided icon={<ArrowLeftRight />} end="chevron" label={t('move_child')} sub={t('move_child_sub')}
                                onClick={() => { setTarget(null); setFound(null); setSearching(false); setStep({ step: 'move', childId: child.Id }); }} />
                            <MobileRow divided icon={<UserMinus />} tone="danger" label={t('remove_child')} sub={t('remove_child_sub', { name: first(child) })}
                                onClick={() => setConfirming(true)} />
                        </>
                    )}
                </div>
                <ConfirmSheet open={confirming} title={t('remove_child_title', { name: first(child) })}
                    body={t('remove_child_body', { name: first(child), names: partners.map((p) => first(p.person)).join(' & ') || t('this_family') })}
                    confirmLabel={t('remove_pill')} onConfirm={() => removeChild(child)} onClose={() => setConfirming(false)} busy={busy} />
            </Sheet>
        );
    }

    // Move a child: the partners' other families, a family of one partner alone, or any family.
    const child = data.children.find((c) => c.Id === step.childId);
    if (!child) return null;
    const options: { value: string; label: string; hint?: string }[] = [];
    for (const o of others) {
        for (const s of o.spouses) {
            if (s.family.Id === family.Id || options.some((x) => x.value === String(s.family.Id))) continue;
            options.push({
                value: String(s.family.Id),
                label: t('with_partner_and', { a: first(o.partner), b: s.person ? displayFullName(s.person) || unknown : t('partner_unknown') }),
                hint: [formatYearOrEmpty(s.family.MarriageDate), tf('children_count', { count: s.children.length })].filter(Boolean).join(' · '),
            });
        }
    }
    if (partners.length === 2) {
        for (const p of partners) options.push({ value: `only-${p.slot}`, label: tf('only', { name: first(p.person) }), hint: t('only_sub') });
    }
    const chosen = found && target === `found-${found.id}` ? { value: String(found.id), label: found.label } : options.find((o) => o.value === target);
    return (
        <Sheet open={open} onClose={onClose} onBack={() => goChild(child.Id, 'children')} title={t('move_title', { name: first(child) })} size="full"
            dirty={false} onSave={() => chosen && moveChild(child, chosen.value, chosen.label)} saveLabel={t('move_pill')} saveWhenClean saveDisabled={busy || !chosen}>
            <Group first title={t('move_to')}>
                <div role="radiogroup" aria-label={t('move_to')} className="-mx-4 -mt-1.5">
                    {options.map((o, i) => (
                        <RadioRow key={o.value} checked={target === o.value} label={o.label} hint={o.hint} divided={i > 0} onSelect={() => { setTarget(o.value); setSearching(false); }} />
                    ))}
                    {found && (
                        <RadioRow checked={target === `found-${found.id}`} label={found.label} divided={options.length > 0} onSelect={() => setTarget(`found-${found.id}`)} />
                    )}
                </div>
                {options.length === 0 && !found && <p className="m-0 text-base text-text-muted">{t('move_none')}</p>}
            </Group>
            <Group>
                {searching ? (
                    <div className="grid gap-2">
                        <FamilySearch treeId={treeId} excludeFamilyId={family.Id} autoFocus autofillKey="mobile-move-child-search"
                            onPick={(f) => {
                                const label = [f.husbandName, f.wifeName].filter(Boolean).join(' & ') || tc('unknown');
                                setFound({ id: f.Id, label });
                                setTarget(`found-${f.Id}`);
                                setSearching(false);
                            }} />
                    </div>
                ) : (
                    <div className="-mx-4 -my-1">
                        <MobileRow icon={<Plus />} end="chevron" label={t('move_search')} onClick={() => setSearching(true)} />
                    </div>
                )}
            </Group>
        </Sheet>
    );
}

/** The relationship to each partner (#982): one choice per partner, or one with one partner. The New family form (#1066) uses it too. */
export function LinkChoices({ partners, links, setLinks, count, first = false }: {
    partners: { slot: Slot; person: PartnerPerson }[];
    links: { partner1: ChildRelationshipType; partner2: ChildRelationshipType };
    setLinks: React.Dispatch<React.SetStateAction<{ partner1: ChildRelationshipType; partner2: ChildRelationshipType }>>;
    count: number;
    first?: boolean;
}) {
    const t = useTranslations('familyPhone');
    const tp = useTranslations('mobilePerson');
    const options = CHILD_RELATIONSHIP_TYPE_VALUES.map((v) => ({ v, l: t(`link_${v}`) }));
    const name = (p: PartnerPerson) => partnerShortName(p) || tp('unknown');
    if (partners.length === 0) return null;
    if (partners.length === 1) {
        const { slot, person } = partners[0];
        return (
            <Group first={first} title={t('relationship_to', { name: name(person), count })}>
                <ChipGroup label={t('relationship_to', { name: name(person), count })} value={links[slot]}
                    onChange={(v) => setLinks({ partner1: v, partner2: v })} options={options} />
            </Group>
        );
    }
    return (
        <>
            {partners.map(({ slot, person }, i) => (
                <Group key={slot} first={first && i === 0} title={t('relationship_to', { name: name(person), count })}>
                    <ChipGroup label={t('relationship_to', { name: name(person), count })} value={links[slot]}
                        onChange={(v) => setLinks((l) => ({ ...l, [slot]: v }))} options={options} />
                </Group>
            ))}
        </>
    );
}

/** A family's note on the phone: add, edit, delete. */
export function FamilyNoteSheet({ note, open, onClose, familyId, treeId, canDelete, run }: {
    /** The note to edit, or null to add one. */
    note: Note | null;
    open: boolean; onClose: () => void; familyId: number; treeId: number | null;
    canDelete: boolean; run: RunChange;
}) {
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) { setWasOpen(open); if (open) setOpened((n) => n + 1); }
    return <NoteBody key={opened} {...{ note, open, onClose, familyId, treeId, canDelete, run }} />;
}

function NoteBody({ note, open, onClose, familyId, treeId, canDelete, run }: Parameters<typeof FamilyNoteSheet>[0]) {
    const t = useTranslations('mobileProfile');
    const uid = useId();
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
            if (note) return body !== note.Text.trim() ? client.notes.update(note.Id, 'Families', familyId, body, treeId) : { auditIds: [] };
            return client.notes.create('Families', familyId, body, treeId);
        }, { message: note ? t('note_saved') : t('note_added') });
        setSaving(false);
        if (ok) onClose();
    };

    const remove = async () => {
        if (!note) return;
        setSaving(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            return client.notes.remove(note.Id, 'Families', familyId, treeId);
        }, { message: t('note_deleted') });
        setSaving(false);
        setConfirming(false);
        if (ok) onClose();
    };

    return (
        <Sheet open={open} onClose={onClose} title={note ? t('note') : t('new_note')} size="full" dirty={dirty} onSave={save}
            saveDisabled={saving || !text.trim()} discardMessage={note ? undefined : t('note_discard')}>
            <label htmlFor={`${uid}-note`} className="sr-only">{t('note')}</label>
            <textarea
                id={`${uid}-note`}
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
                <ConfirmSheet open={confirming} title={t('delete_note_title')} body={t('delete_note_body')}
                    confirmLabel={t('delete_note')} onConfirm={remove} onClose={() => setConfirming(false)} busy={saving} />
            )}
        </Sheet>
    );
}
