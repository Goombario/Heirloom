'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FamilyType, Family } from '@/lib/db/schema';
import type { HierarchyLevel } from '@/lib/geocode/photon';
import type { ChildRelationshipType } from '@/lib/child-relationship';
import { getDataClient } from '@/lib/data';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { formatYearOrEmpty, sortableYear } from '@/lib/date-utils';
import { displayFullName } from '@/lib/utils/names';
import { useTree } from '@/app/contexts/TreeContext';
import DateInput from '@/app/components/DateInput';
import LocationField from '@/app/components/LocationField';
import { PersonPickerSheet, type PickedPerson } from '@/app/components/PersonPickerSheet';
import type { PendingCitation } from '@/app/components/AttachSourceSidebar';
import { CiteSheets } from '@/app/components/citations/CiteSheets';
import { useCachedResource } from '@/app/components/useCachedResource';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { usePlaceResolutionFlush } from '@/app/components/usePlaceResolutionFlush';
import { Lifespan, MobileRow, SegmentedControl, citeClass, cx, fieldClass, showChangeToast, showErrorToast } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { ChevronRight, Plus, UserMinus } from '@/lib/icons';
import { peopleListKey } from '@/app/people/peopleListKey';
import { END_REASON_TAGS, childRelationshipTags, partnerShortName } from '@/app/families/view/derive';
import type { PartnerPerson } from '@/app/families/view/useFamilyDetail';
import type { Slot } from '@/app/families/view/mobile/model';
import { coupleName } from '@/app/families/view/mobile/model';
import { ftypeKey } from '@/app/families/view/mobile/panes';
import { ChipGroup, Face, Group } from '@/app/families/view/mobile/parts';
import { LinkChoices } from '@/app/families/view/mobile/PeopleSheets';
import {
    childWindow, existingId, faceOf, firstDeath, inBirthOrder, likelyChildren, partnerSuggestions, PARTNER_SPREAD, sharedFamily, slotLinks, stage,
    takenIds, type PoolPerson, type Staged, type StagedChild, type StagedFace,
} from './model';

/*
 * The phone New family form (#1066, umbrella #1067): a full-height sheet over the
 * families list with Cancel, "New family" and one copper Save. Partners as stacked
 * rows, the type as chips, when it started, how it ended, and children with their
 * relationship to each partner (#982). Nothing is written until Save: people made in
 * the pickers, children, the ending and citations are all staged, as on desktop.
 */

const FAMILY_TYPES: FamilyType[] = ['Marriage', 'Civil union', 'Common-law', 'Other', 'Unknown'];
type Reason = 'Divorce' | 'Annulment' | 'Separation';
type How = 'death' | Reason;
const HOWS: How[] = ['death', 'Divorce', 'Annulment', 'Separation'];
const isReason = (h: How | null): h is Reason => h != null && h !== 'death';

/** Which citations a pending one belongs to: the start (the family row) or the ending event. */
type CiteFor = 'start' | 'end';

type Sub =
    | { kind: 'partner' }
    | { kind: 'children' }
    | { kind: 'child'; key: string }
    | { kind: 'cite'; what: CiteFor }
    | { kind: 'clear-end' };

/**
 * Runs `go` once the closed sheet has taken its history step back off (sheetStack), so
 * the navigation starts from this page's own entry; a beat later if no step was there.
 */
export function afterSheetStep(go: () => void) {
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        window.removeEventListener('popstate', finish);
        go();
    };
    window.addEventListener('popstate', finish);
    window.setTimeout(finish, 400);
}

export interface NewFamilySheetProps {
    open: boolean;
    onClose: () => void;
    /** Saved: the caller opens the new family's page. */
    onCreated: (familyId: number) => void;
}

export function NewFamilySheet(props: NewFamilySheetProps) {
    // A fresh form each time it opens; the last one stays drawn while it closes.
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(props.open);
    if (props.open !== wasOpen) { setWasOpen(props.open); if (props.open) setOpened((n) => n + 1); }
    return <Form key={opened} {...props} />;
}

function Form({ open, onClose, onCreated }: NewFamilySheetProps) {
    const t = useTranslations('newFamilyPhone');
    const tf = useTranslations('mobileFamily');
    const tp = useTranslations('familyPhone');
    const te = useTranslations('mobileEvents');
    const tpk = useTranslations('personPicker');
    const tef = useTranslations('editFamily');
    const tc = useTranslations('common');
    const ids = useId();
    const { activeTreeId: treeId } = useTree();
    const { reportError } = useErrorToast();
    const flushPlace = usePlaceResolutionFlush(treeId);

    const [partners, setPartners] = useState<Staged[]>([]);
    const [children, setChildren] = useState<StagedChild[]>([]);
    const [type, setType] = useState<FamilyType>('Marriage');
    const [date, setDate] = useState('');
    const [place, setPlace] = useState('');
    const [placeRes, setPlaceRes] = useState<HierarchyLevel[] | null | undefined>(undefined);
    // The place each field links to (#1186), when one of the tree's was picked.
    const [placeId, setPlaceId] = useState<number | null>(null);
    const [endedChosen, setEndedChosen] = useState(false);
    const [how, setHow] = useState<How | null>(null);
    const [endDate, setEndDate] = useState('');
    const [endPlace, setEndPlace] = useState('');
    const [endPlaceRes, setEndPlaceRes] = useState<HierarchyLevel[] | null | undefined>(undefined);
    const [endPlaceId, setEndPlaceId] = useState<number | null>(null);
    const [pending, setPending] = useState<(PendingCitation & { for: CiteFor })[]>([]);
    const [sub, setSub] = useState<Sub | null>(null);
    const [childLinks, setChildLinks] = useState<{ partner1: ChildRelationshipType; partner2: ChildRelationshipType }>({ partner1: 'Birth', partner2: 'Birth' });
    const [saving, setSaving] = useState(false);
    const closeSub = () => setSub(null);

    // The tree's people, the people page's cached copy: suggestions, partnership counts, deaths.
    const poolRes = useCachedResource(open ? peopleListKey(treeId) : null, async () => {
        const client = await getDataClient();
        return client.people.list({ treeId });
    });
    const pool = useMemo(() => (poolRes.data?.people ?? []) as PoolPerson[], [poolRes.data]);
    const poolRow = (id: number | null) => (id == null ? undefined : pool.find((p) => p.Id === id));

    const faces = partners.map(faceOf);
    const taken = takenIds(partners, children);
    const unknown = tc('unknown');
    const shortOf = (f: StagedFace) => partnerShortName(f as PartnerPerson) || unknown;
    const names = faces.map(shortOf).join(' & ');

    // The family these two already share (the amber block): fetched once both are in the tree.
    const p1 = partners[0] ? existingId(partners[0]) : null;
    const p2 = partners[1] ? existingId(partners[1]) : null;
    const [shared, setShared] = useState<{ pair: string; family: Family | null } | null>(null);
    useEffect(() => {
        if (p1 == null || p2 == null) return;
        let cancelled = false;
        (async () => {
            try {
                const client = await getDataClient();
                const person = await client.people.get(p1, treeId);
                if (!cancelled) setShared({ pair: `${p1}:${p2}`, family: sharedFamily((person?.familiesAsSpouse ?? []) as Family[], p1, p2) });
            } catch { /* only a warning: nothing to show */ }
        })();
        return () => { cancelled = true; };
    }, [p1, p2, treeId]);
    const sharedNow = p1 != null && p2 != null && shared?.pair === `${p1}:${p2}` ? shared.family : null;

    // A partner's recorded death ends the family; Active is then off.
    const dead = firstDeath(partners, pool);
    const ended = endedChosen || dead != null;
    const howNow: How | null = how ?? (dead ? 'death' : null);
    const endPending = pending.filter((p) => p.for === 'end');
    const hasEndData = isReason(howNow) && (endDate.trim() !== '' || endPlace.trim() !== '' || endPending.length > 0);

    const dirty = partners.length > 0 || children.length > 0 || type !== 'Marriage' || date !== '' || place !== ''
        || endedChosen || how != null || endDate !== '' || endPlace !== '' || pending.length > 0;
    const valid = partners.length > 0 || children.length > 0;
    useUnsavedChangesGuard(open && dirty && !saving);

    const kidWindow = childWindow(faces);
    const likely = likelyChildren(faces, pool, taken);
    const suggestedPartners = partners.length === 1 ? partnerSuggestions(faces[0], pool, taken) : [];
    const otherBorn = partners.length === 1 ? sortableYear(faces[0].BirthDate) : null;

    /* ── Changes ── */

    const addPartner = (picked: PickedPerson | undefined) => {
        if (!picked) return;
        setPartners((ps) => (ps.length >= 2 ? ps : [...ps, stage(picked)]));
        closeSub();
    };
    const removePartner = (key: string) => setPartners((ps) => ps.filter((p) => p.key !== key));
    const addChildren = (picked: PickedPerson[]) => {
        setChildren((cs) => [
            ...cs,
            ...picked.filter((p) => p.kind === 'new' || !cs.some((c) => existingId(c) === p.person.Id)).map((p) => ({ ...stage(p), links: {} })),
        ]);
    };
    const openChild = (c: StagedChild) => {
        setChildLinks(slotLinks(c, partners));
        setSub({ kind: 'child', key: c.key });
    };
    const applyChild = (key: string) => {
        setChildren((cs) => cs.map((c) => {
            if (c.key !== key) return c;
            const links: Record<string, ChildRelationshipType> = {};
            if (partners[0]) links[partners[0].key] = childLinks.partner1;
            if (partners[1]) links[partners[1].key] = partners.length === 2 ? childLinks.partner2 : childLinks.partner1;
            return { ...c, links };
        }));
        closeSub();
    };
    const pickStatus = (v: string) => {
        if (v === 'ended') { setEndedChosen(true); return; }
        if (hasEndData) { setSub({ kind: 'clear-end' }); return; }
        clearEnd();
    };
    const clearEnd = () => {
        setEndedChosen(false); setHow(null); setEndDate(''); setEndPlace(''); setEndPlaceRes(undefined); setEndPlaceId(null);
        setPending((ps) => ps.filter((p) => p.for !== 'end'));
        closeSub();
    };

    /* ── Save ── */

    async function save() {
        if (saving || !valid) return;
        setSaving(true);
        const client = await getDataClient();
        const made: number[] = [];
        const peopleIds = new Map<string, number>();
        const idOf = async (s: Staged) => {
            if (s.picked.kind === 'existing') return s.picked.person.Id;
            const d = s.picked.draft;
            const created = await client.people.create({ FirstName: d.firstName || null, LastName: d.lastName || null, Sex: d.sex, BirthDate: d.birthDate }, { treeId });
            made.push(...created.auditIds);
            return created.Id;
        };

        // The people and the family itself: all or nothing, so a failed save leaves no one behind.
        let familyId: number;
        let savedPlaceId: number | null | undefined;
        try {
            for (const s of [...partners, ...children]) peopleIds.set(s.key, await idOf(s));
            const family = await client.families.create({
                Partner1Id: partners[0] ? peopleIds.get(partners[0].key) ?? null : null,
                Partner2Id: partners[1] ? peopleIds.get(partners[1].key) ?? null : null,
                Type: type,
                MarriageDate: date.trim() || null,
                MarriagePlace: place.trim() || null,
                MarriagePlaceId: place.trim() ? placeId : null,
            }, treeId);
            familyId = family.Id;
            savedPlaceId = family.MarriagePlaceId;
        } catch (e) {
            if (made.length > 0) { try { await client.audit.revert(made, treeId); } catch { /* report the first error */ } }
            reportError(e);
            setSaving(false);
            return;
        }

        // The rest is named when it fails; the family exists, so it opens either way.
        const failed: string[] = [];
        try { await flushPlace(place.trim(), placeRes, savedPlaceId); } catch { /* best effort, as on desktop */ }
        for (const c of inBirthOrder(children)) {
            try {
                await client.families.addChild(familyId, peopleIds.get(c.key) as number, slotLinks(c, partners), treeId);
            } catch {
                failed.push(tef('partial_save_child', { name: displayFullName(faceOf(c)) || unknown }));
            }
        }
        let endEventId: number | null = null;
        if (ended && isReason(howNow)) {
            try {
                const ev = await client.events.create({ Type: END_REASON_TAGS[howNow], Date: endDate.trim() || null, Place: endPlace.trim() || null, PlaceId: endPlace.trim() ? endPlaceId : null, FamilyId: familyId }, treeId);
                endEventId = ev.Id;
                try { await flushPlace(endPlace.trim(), endPlaceRes, ev.PlaceId); } catch { /* best effort */ }
            } catch {
                failed.push(t('partial_end', { reason: howNow }));
            }
        }
        for (const pc of pending) {
            const factId = pc.for === 'start' ? familyId : endEventId;
            if (factId == null) continue;
            let sourceId = pc.sourceId;
            if (sourceId == null && pc.newSource) {
                try {
                    sourceId = (await client.sources.create(pc.newSource, treeId)).Id;
                } catch {
                    failed.push(tef('partial_save_source'));
                    continue;
                }
            }
            if (sourceId == null) continue;
            try {
                await client.citations.create({ FactTable: pc.for === 'start' ? FACT_TABLES.FAMILIES : FACT_TABLES.EVENTS, FactId: factId, SourceId: sourceId, Page: pc.page, Quay: pc.quay ?? null, DataText: pc.dataText ?? null, Url: pc.url ?? null }, treeId);
            } catch {
                failed.push(tef('partial_save_citation'));
            }
        }

        const name = coupleName(faces[0] as PartnerPerson ?? null, faces[1] as PartnerPerson ?? null) || tp('family');
        if (failed.length > 0) showErrorToast(tef('partial_save_failed', { details: failed.join('; ') }));
        else showChangeToast({ message: t('added', { name }) });
        onCreated(familyId);
    }

    /* ── Pieces ── */

    const citeLink = (what: CiteFor, label: string) => {
        const n = pending.filter((p) => p.for === what).length;
        return (
            <button type="button" onClick={() => setSub({ kind: 'cite', what })} aria-label={t('cite_label', { what: label })}
                className="relative inline-flex items-center gap-1 text-sm font-medium text-link cursor-pointer before:absolute before:-inset-2.5 before:content-[''] focus-ring">
                {n > 0 && <span className={citeClass()} aria-hidden="true">{n}</span>}
                {t('cite')}
                <ChevronRight className="w-[15px] h-[15px] text-text-muted" aria-hidden="true" />
            </button>
        );
    };
    const head = (title: string, cite?: React.ReactNode) => (
        <div className="flex items-baseline justify-between gap-2">
            <h3 className="eyebrow m-0">{title}</h3>
            {cite}
        </div>
    );
    const field = (id: string, label: string, control: React.ReactNode) => (
        <div className="grid gap-1.5">
            <label htmlFor={id} className="text-meta font-medium text-text-secondary">{label}</label>
            {control}
        </div>
    );
    const dates = (f: StagedFace) => (f.BirthDate || f.DeathDate ? <Lifespan birth={f.BirthDate} death={f.DeathDate} /> : null);
    const subLine = (...bits: React.ReactNode[]) => {
        const shown = bits.filter(Boolean);
        return shown.length ? <>{shown.map((b, i) => <React.Fragment key={i}>{i > 0 && ' · '}{b}</React.Fragment>)}</> : undefined;
    };
    const faceTree = (s: Staged) => (s.picked.kind === 'existing' ? treeId : null);
    const startWord = tf(type === 'Marriage' ? 'married' : 'started');
    const childLinkText = (c: StagedChild) => {
        const l = slotLinks(c, partners);
        return childRelationshipTags({ Partner1Relationship: l.partner1, Partner2Relationship: l.partner2 }, (faces[0] as PartnerPerson) ?? null, (faces[1] as PartnerPerson) ?? null)
            .map((tag) => (tag.name ? tef(`rel_of_${tag.type.toLowerCase()}`, { name: tag.name }) : tef(`rel_${tag.type.toLowerCase()}`)))
            .join(' · ');
    };
    const slotPartners: { slot: Slot; person: PartnerPerson }[] = partners.map((s, i) => ({ slot: i === 0 ? 'partner1' : 'partner2', person: faceOf(s) as PartnerPerson }));
    const citeFact = (what: CiteFor) => ({
        factTable: what === 'start' ? FACT_TABLES.FAMILIES : FACT_TABLES.EVENTS,
        factId: 0,
        label: what === 'start' ? startWord : isReason(howNow) ? tp(`reason_${howNow}`) : tp('ended'),
        value: '',
        citations: [],
    });

    /* ── Sections ── */

    const partnersSection = (
        <Group first title={tp('partners')}>
            <div className="-mx-4 -mt-1">
                {partners.map((s, i) => {
                    const f = faceOf(s);
                    const others = poolRow(existingId(s))?.PartnershipCount ?? 0;
                    return (
                        <div key={s.key} className={cx('flex items-center gap-3 px-4 py-2.5', i > 0 && 'border-t border-border')}>
                            <Face person={f as PartnerPerson} size={36} treeId={faceTree(s)} />
                            <span className="flex-1 min-w-0 grid gap-px">
                                <span className="serif text-md font-semibold leading-snug text-text">{displayFullName(f) || unknown}</span>
                                <span className="text-meta text-text-muted">
                                    {subLine(dates(f), others > 0 && tp('other_partnerships_count', { count: others }), s.picked.kind === 'new' && tpk('new_badge'))}
                                </span>
                            </span>
                            <button type="button" onClick={() => removePartner(s.key)} aria-label={t('remove_named', { name: displayFullName(f) || unknown })}
                                className="relative shrink-0 text-sm font-medium text-link cursor-pointer before:absolute before:-inset-3 before:content-[''] focus-ring">
                                {t('remove')}
                            </button>
                        </div>
                    );
                })}
                {partners.length < 2 && (
                    <MobileRow divided={partners.length > 0} icon={<Plus />} end="chevron"
                        label={partners.length ? t('add_other_partner') : tf('add_partner_row')} onClick={() => setSub({ kind: 'partner' })} />
                )}
            </div>
            {sharedNow && (
                <div role="status" className="rounded-[14px] bg-[color:var(--warning-bg)] px-3.5 pt-3 pb-1">
                    <h4 className="m-0 text-base font-semibold text-[color:var(--warning-text)]">{t('shared_title')}</h4>
                    <p className="m-0 mt-0.5 text-meta text-text-secondary">{t('shared_body')}</p>
                    <div className="-mx-3.5">
                        <MobileRow href={`/families/view?id=${sharedNow.Id}`} end="leave"
                            label={<span className="serif text-md font-semibold">{coupleName(faces[0] as PartnerPerson, faces[1] as PartnerPerson)}</span>}
                            sub={sharedNow.MarriageDate ? <span className="date-mono date-muted">{formatYearOrEmpty(sharedNow.MarriageDate)}</span> : undefined} />
                    </div>
                </div>
            )}
        </Group>
    );

    const typeSection = (
        <Group title={tp('row_type')}>
            <ChipGroup label={tp('row_type')} value={type} onChange={setType} options={FAMILY_TYPES.map((v) => ({ v, l: tf(`ftype_${ftypeKey(v)}`) }))} />
        </Group>
    );

    const startSection = (
        <Group>
            {head(startWord, citeLink('start', startWord))}
            {field(`${ids}-date`, te('field_date'),
                <DateInput id={`${ids}-date`} value={date} onChange={setDate} qualifierChips className={cx(fieldClass(), 'min-h-11')} />)}
            {field(`${ids}-place`, te('field_place'),
                <LocationField id={`${ids}-place`} value={place} onChange={setPlace} onResolve={setPlaceRes} onRemove={() => setPlaceRes(null)}
                    placeId={placeId} onPlaceIdChange={setPlaceId} variant="sheet" label={te('field_place')}
                    treeId={treeId} className={cx(fieldClass(), 'min-h-11')} placeholder={te('place_placeholder')} />)}
        </Group>
    );

    const deadYear = dead ? formatYearOrEmpty(dead.DeathDate) || '?' : '';
    const statusSection = (
        <>
            <Group>
                <span aria-hidden="true" className="text-meta font-medium text-text-secondary">{t('status')}</span>
                <SegmentedControl aria-label={t('status')} fullWidth value={ended ? 'ended' : 'active'} onChange={pickStatus}
                    options={[{ v: 'active', l: t('active'), disabled: dead != null }, { v: 'ended', l: t('ended') }]} />
                {dead && <p className="m-0 text-meta text-text-muted">{t('death_forces', { name: shortOf(dead), year: deadYear })}</p>}
            </Group>
            {ended && (
                <Group>
                    {head(tp('how_it_ended'), isReason(howNow) ? citeLink('end', tp(`reason_${howNow}`)) : undefined)}
                    <ChipGroup label={tp('how_it_ended')} value={howNow} onChange={(v) => { setHow(v); setEndedChosen(true); }}
                        options={HOWS.map((v) => ({ v, l: v === 'death' ? tp('death') : tp(`reason_${v}`) }))} />
                    {isReason(howNow) ? (
                        <>
                            {field(`${ids}-end-date`, te('field_date'),
                                <DateInput id={`${ids}-end-date`} value={endDate} onChange={setEndDate} qualifierChips className={cx(fieldClass(), 'min-h-11')} />)}
                            {field(`${ids}-end-place`, te('field_place'),
                                <LocationField id={`${ids}-end-place`} value={endPlace} onChange={setEndPlace} onResolve={setEndPlaceRes} onRemove={() => setEndPlaceRes(null)}
                                    placeId={endPlaceId} onPlaceIdChange={setEndPlaceId} variant="sheet" label={te('field_place')}
                                    treeId={treeId} className={cx(fieldClass(), 'min-h-11')} placeholder={te('place_placeholder')} />)}
                            <p className="m-0 text-meta text-text-muted">{t('saved_as', { reason: howNow })}</p>
                        </>
                    ) : (
                        <p className="m-0 text-meta text-text-muted">
                            {howNow === 'death'
                                ? (dead ? t('death_from_page', { name: shortOf(dead), year: deadYear }) : t('death_none'))
                                : t('pick_how')}
                        </p>
                    )}
                </Group>
            )}
        </>
    );

    const ordered = inBirthOrder(children);
    const childrenSection = (
        <Group title={children.length ? t('children_count', { count: children.length }) : tp('children')}>
            <div className="-mx-4 -mt-1">
                {ordered.map((c, i) => {
                    const f = faceOf(c);
                    return (
                        <MobileRow key={c.key} divided={i > 0} end="chevron" lead={<Face person={f as PartnerPerson} size={36} treeId={faceTree(c)} />}
                            label={<span className="serif text-md font-semibold">{displayFullName(f) || unknown}</span>}
                            sub={subLine(dates(f), childLinkText(c), c.picked.kind === 'new' && tpk('new_badge'))}
                            onClick={() => openChild(c)} />
                    );
                })}
                <MobileRow divided={children.length > 0} icon={<Plus />} end="chevron"
                    label={children.length ? t('add_more_children') : t('add_children')} onClick={() => setSub({ kind: 'children' })} />
                {kidWindow && likely.length > 0 && (
                    <>
                        <div className="eyebrow px-4 pt-3 pb-1">{t('likely', { from: kidWindow.from, to: kidWindow.to })}</div>
                        {likely.slice(0, 3).map((p, i) => (
                            <MobileRow key={p.Id} divided={i > 0} suggestion aria-label={t('add_as_child', { name: displayFullName(p) || unknown })}
                                lead={<Face person={p as unknown as PartnerPerson} size={36} treeId={treeId} />}
                                label={<span className="serif text-md font-semibold">{displayFullName(p) || unknown}</span>}
                                sub={dates(p) ?? undefined}
                                onClick={() => addChildren([{ kind: 'existing', person: p }])} />
                        ))}
                    </>
                )}
            </div>
        </Group>
    );

    /* ── Sub-sheets ── */

    const child = sub?.kind === 'child' ? children.find((c) => c.key === sub.key) ?? null : null;
    const childFace = child ? faceOf(child) : null;
    const childDirty = child != null && (() => {
        const l = slotLinks(child, partners);
        return l.partner1 !== childLinks.partner1 || (partners.length === 2 && l.partner2 !== childLinks.partner2);
    })();

    const subSheets = (
        <>
            <PersonPickerSheet
                open={sub?.kind === 'partner'}
                onClose={closeSub}
                title={tp('add_partner')}
                treeId={treeId}
                excludeIds={taken}
                suggested={suggestedPartners.length > 0 && otherBorn != null
                    ? { label: t('partner_suggested', { from: otherBorn - PARTNER_SPREAD, to: otherBorn + PARTNER_SPREAD }), people: suggestedPartners }
                    : undefined}
                onPick={(picked) => addPartner(picked[0])}
                allowCreate
                createHint={partners.length ? t('partner_create_hint', { name: shortOf(faces[0]) }) : t('partner_create_hint_alone')}
            />
            <PersonPickerSheet
                open={sub?.kind === 'children'}
                onClose={closeSub}
                title={t('add_children')}
                treeId={treeId}
                multiple
                excludeIds={taken}
                suggested={kidWindow && likely.length > 0 ? { label: t('children_suggested', { from: kidWindow.from, to: kidWindow.to }), people: likely } : undefined}
                onPick={(picked) => { if (picked.length) addChildren(picked); closeSub(); }}
                allowCreate
                defaultLastName={faces[0]?.LastName ?? undefined}
                createHint={names ? t('child_create_hint', { names }) : t('child_create_hint_alone')}
            />
            <Sheet open={child != null} onClose={closeSub} title={childFace ? displayFullName(childFace) || unknown : ''} size="full"
                dirty={childDirty} onSave={() => child && applyChild(child.key)} saveLabel={t('done')} saveWhenClean>
                {child && childFace && (
                    <>
                        <div className="flex items-center gap-3 pt-4 pb-1">
                            <Face person={childFace as PartnerPerson} size={48} treeId={faceTree(child)} />
                            <span className="grid gap-px">
                                <span className="serif text-md font-semibold text-text">{displayFullName(childFace) || unknown}</span>
                                {dates(childFace) && <span className="text-meta text-text-muted">{dates(childFace)}</span>}
                            </span>
                        </div>
                        <LinkChoices partners={slotPartners} links={childLinks} setLinks={setChildLinks} count={1} />
                        {partners.length === 0 && <p className="m-0 pt-3 text-meta text-text-muted">{t('child_no_partners')}</p>}
                        <div className="-mx-4 mt-3 border-t border-border">
                            <MobileRow icon={<UserMinus />} tone="danger" label={t('remove_child')} sub={t('remove_child_sub')}
                                onClick={() => { setChildren((cs) => cs.filter((c) => c.key !== child.key)); closeSub(); }} />
                        </div>
                    </>
                )}
            </Sheet>
            <CiteSheets
                target={sub?.kind === 'cite' ? { fact: citeFact(sub.what), start: 'pick' } : null}
                subject={names || t('title')}
                sourceNumbers={new Map()}
                canCite
                canDelete={false}
                research={null}
                onClose={closeSub}
                onChanged={() => undefined}
                onPending={(pc) => { if (sub?.kind === 'cite') { const what = sub.what; setPending((ps) => [...ps, { ...pc, for: what }]); } }}
            />
            <ConfirmSheet
                open={sub?.kind === 'clear-end'}
                title={t('clear_end_title', { reason: isReason(howNow) ? howNow : 'Divorce' })}
                body={t('clear_end_body')}
                confirmLabel={t('clear_end_pill', { reason: isReason(howNow) ? howNow : 'Divorce' })}
                keepLabel={t('keep_it')}
                onConfirm={clearEnd}
                onClose={closeSub}
            />
        </>
    );

    return (
        <Sheet open={open} onClose={onClose} title={t('title')} size="full" dirty={dirty} onSave={save} saveDisabled={saving || !valid}
            discardMessage={t('discard')}>
            {partnersSection}
            {typeSection}
            {startSection}
            {statusSection}
            {childrenSection}
            {subSheets}
        </Sheet>
    );
}
