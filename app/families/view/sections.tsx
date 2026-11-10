'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { livingStatus } from '@/lib/living';
import { ArrowLeftRight, MapPin, StickyNote } from '@/lib/icons';
import { formatDateForDisplay, sortableYear, compareSortableYears } from '@/lib/date-utils';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { useLanguage } from '@/app/components/LanguageProvider';
import { getInitials } from '@/lib/utils/initials';
import PersonAvatar from '@/app/components/PersonAvatar';
import Cite from '@/app/components/Cite';
import LocationMap from '@/app/components/LocationMap';
import { AddRow, Badge, Button, EditorActions, Lifespan, RowAction, RowActions, Select } from '@/app/components/ui';
import { useReturnFocus } from '@/app/hooks/useReturnFocus';
import { escapeToCancel, useEditorFocusReturn } from '@/app/hooks/useEditorFocusReturn';
import PersonPicker, { type PersonPickerHandle } from '@/app/components/PersonPicker';
import { MoveChildPanel } from './MoveChildPanel';
import { useUndoRemoval } from '@/app/hooks/useUndoRemoval';
import { CHILD_RELATIONSHIP_TYPE_VALUES, isChildRelationshipType, type ChildRelationships } from '@/lib/child-relationship';
import { Timeline, TimelineWhenWhere, type TimelineItem } from '@/app/components/Timeline';
import { useTimelineMarks, type DataCheckMarks } from '@/app/components/data-checks/marks';
import { eventGlyph } from '@/app/components/eventGlyph';
import { EventRowActions } from '@/app/components/EventRowActions';
import InlineEventEditor from '@/app/components/InlineEventEditor';
import InlineMarriageEditor from './InlineMarriageEditor';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { familyEventLabel } from '@/app/components/familyEventTypes';
import { getDataClient } from '@/lib/data';
import type { ChildRelationshipType } from '@/lib/data/types';
import { useTree } from '@/app/contexts/TreeContext';
import EventMediaStrip from '@/app/components/media/EventMediaStrip';
import type { GedcomEvent, EventWithMedia, FamilyType, Media } from '@/lib/db/schema';
import { partnerName, partnerShortName, yearOnly, calcAgeAtDeath, hasRecordedDeath, partnershipKindKey, derivedEndPrecedesStart, childRelationshipTags } from './derive';
import { prefetchFamily } from './familyCache';
import { prefetchPerson } from '@/app/people/view/personCache';
import type { PartnerPerson, CitationRow, PartnerFamilies } from './useFamilyDetail';
import type { CitationMap } from './useFamilyDetail';
import { chipCitations, type SourceNumbers } from '@/app/components/citations/factDescriptors';
import { FACT_TABLES, type FactTableValue } from '@/lib/db/fact-tables';
import { OwnerNotesCard, NoteCount } from '@/app/components/notes/OwnerNotesCard';
import { factPlaceEntry } from '@/lib/places/place-key';

// No "Partner role: Spouse" line: both partners' role comes from the family type, which
// the hero subtitle already names, so it could only ever repeat (#768, DV-3).
export function PartnerCard({ partner, treeId }: { partner: PartnerPerson | null; treeId: number | null }) {
    const t = useTranslations('families');
    const tCommon = useTranslations('common');
    if (!partner) {
        return (
            <div className="card card-pad row gap-3.5 p-4 items-center justify-center min-h-24">
                <span className="muted text-sm italic">{t('unknown_partner')}</span>
            </div>
        );
    }
    return (
        <Link
            href={`/people/view?id=${partner.Id}`}
            className="card card-pad row gap-3.5 p-4 no-underline items-center"
            style={{ color: 'inherit' }}
            onMouseEnter={() => prefetchPerson(partner.Id, treeId)}
            onFocus={() => prefetchPerson(partner.Id, treeId)}
        >
            <PersonAvatar
                mediaId={partner.PrimaryMediaId}
                treeId={treeId}
                name={partnerName(partner) || tCommon('unknown')}
                initials={getInitials(partner.FirstName, partner.LastName)}
                sex={partner.Sex}
                size={64}
                focalX={partner.FocalX}
                focalY={partner.FocalY}
                focalRadius={partner.FocalRadius}
            />
            <div className="flex-1 min-w-0">
                <div className="serif font-semibold leading-[1.2]" style={{ fontSize: 'var(--text-lg)', color: 'var(--color-text)' }}>
                    {partnerName(partner) || tCommon('unknown')}
                </div>
                {/* A hero, so the full lifespan (#766). */}
                <Lifespan
                    variant="full"
                    birth={partner.BirthDate}
                    death={partner.DeathDate}
                    birthPlace={partner.BirthPlace}
                    deathPlace={partner.DeathPlace}
                    className="muted text-meta mt-0.5 block"
                />
            </div>
        </Link>
    );
}

interface TimelineFamily {
    Id: number;
    MarriageDate: string | null;
    MarriagePlace: string | null;
    MarriagePlaceId?: number | null;
    /** Drives the start-anchor row's wording — a common-law family must not read "marriage". */
    Type?: FamilyType | null;
    events?: EventWithMedia[];
    /** The marriage's own photos (ADR 0030), shown on its row. */
    marriageMedia?: Media[];
    /** The children's adoption events (#485). */
    childAdoptions?: GedcomEvent[];
}

export function FamilyTimeline({
    family, childList, citationMap, sourceNumbers, canEdit, canDelete, placeCoords, isOpen, toggle, earlierPartner, onCitationClick, onChanged, relevantPersonIds, footer, marks,
}: {
    family: TimelineFamily;
    childList: PartnerPerson[];
    citationMap: CitationMap;
    /** Page-local footnote numbers shared with Sources cited (#754). */
    sourceNumbers: SourceNumbers;
    canEdit: boolean;
    /** Permit destructive note deletion (owner/edit); contributors may edit notes. */
    canDelete: boolean;
    placeCoords: Record<string, { lat: number; lng: number }>;
    isOpen: (k: string) => boolean;
    toggle: (k: string) => void;
    earlierPartner: PartnerPerson | null;
    onCitationClick: (factTable: FactTableValue, factId: number, factLabel: string, citation: CitationRow | null, anchor?: HTMLElement) => void;
    /** Refresh the family after a family-event edit/delete. */
    onChanged: () => void;
    /** Already-loaded family members for event-media picker suggestions. */
    relevantPersonIds?: readonly number[];
    /**
     * The list's last row (#760): the trailing "Add event" row, or the inline panel
     * it opened. Rendered inside the card under a hairline.
     */
    footer?: React.ReactNode;
    /**
     * The family's dates to check (#833). Only the start and the family's own
     * events can carry a mark: a partner's death isn't a row here, and derived
     * rows never get one. The hero flag covers the rest.
     */
    marks?: DataCheckMarks;
}) {
    const t = useTranslations('families');
    const tPerson = useTranslations('personDetail');
    const tc = useTranslations('common');
    const te = useTranslations('eventEdit');
    const { language } = useLanguage();
    const dateWords = useDateQualifierWords();
    const { activeTreeId } = useTree();
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editingMarriage, setEditingMarriage] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<GedcomEvent | null>(null);
    // Back to the row's Edit (or the panel, if the row was deleted) on close (#798).
    const eventsRef = useRef<HTMLDivElement>(null);
    const rememberEventOpener = useEditorFocusReturn(editingId !== null || editingMarriage, eventsRef);
    const markRow = useTimelineMarks(marks);
    const [noteCounts, setNoteCounts] = useState<Record<number, number>>({});

    const glyphIcon = (type: string) => {
        const { Icon } = eventGlyph(type);
        return <Icon size={15} strokeWidth={2} aria-hidden="true" />;
    };
    // A place → optional "show map" toggle + mini map, as a timeline `extra`.
    const mapExtra = (place: string | null | undefined, placeId: number | null | undefined, key: string) => {
        const at = factPlaceEntry(placeCoords, place, placeId);
        if (!place || !at) return null;
        const open = isOpen(key);
        return (
            <>
                <button type="button" onClick={() => toggle(key)}
                    className="inline-flex items-center gap-1 p-0 text-meta text-link hover:underline rounded-lg transition-colors bg-transparent border-0 cursor-pointer"
                    aria-expanded={open}>
                    <MapPin width="11" height="11" aria-hidden="true" />
                    {open ? tc('hide_map') : tc('show_map')}
                </button>
                {open && (
                    <div className="mt-2">
                        <LocationMap markers={[{ lat: at.lat, lng: at.lng, label: place }]} variant="mini" />
                    </div>
                )}
            </>
        );
    };
    // The date as the row shows it, not the stored GEDCOM form (#901).
    const eventLabel = (ev: GedcomEvent) => [familyEventLabel(ev.Type, te), ev.Date && formatDateForDisplay(ev.Date, language, dateWords), ev.Place].filter(Boolean).join(' · ');
    // What to call the union itself, per type — "marriage" for a Marriage, but
    // "common-law partnership" for a Common-law family, which previously read
    // "Started · marriage" regardless. Used by the start row, its edit action,
    // the citation fact label, and the start editor's caption.
    const kindLabel = t(partnershipKindKey(family.Type));
    // A fact's numbered chips, plus an editor's hover "+" for another source
    // (#900), or its "+" pin when nothing cites it yet.
    const citePins = (factTable: FactTableValue, factId: number, label: string, more = true) => {
        const cited = citationMap[`${factTable}:${factId}`] ?? [];
        if (cited.length === 0) {
            return <Cite empty factLabel={label} searchOnly={!canEdit} onClick={() => onCitationClick(factTable, factId, label, null)} />;
        }
        return (
            <>
                {chipCitations(cited, sourceNumbers).map(c => <Cite key={c.Id} n={sourceNumbers.get(c.SourceId)} sourceTitle={c.sourceTitle ?? undefined} onClick={(anchor) => onCitationClick(factTable, factId, label, c, anchor)} />)}
                {canEdit && more && <Cite more factLabel={label} onClick={() => onCitationClick(factTable, factId, label, null)} />}
            </>
        );
    };

    // The start row is the family fact; an imported `1 MARR` / `2 SOUR` cites the
    // marriage itself (#962), so its chips sit beside the family's, and the empty
    // "+" pin shows only when neither has a citation.
    const marriageCited = (citationMap[`${FACT_TABLES.FAMILY_MARRIAGE}:${family.Id}`] ?? []).length > 0;
    const familyCited = (citationMap[`${FACT_TABLES.FAMILIES}:${family.Id}`] ?? []).length > 0;
    const marriagePins = (
        <>
            {(familyCited || !marriageCited) && citePins(FACT_TABLES.FAMILIES, family.Id, kindLabel, false)}
            {marriageCited && citePins(FACT_TABLES.FAMILY_MARRIAGE, family.Id, kindLabel, false)}
            {/* One "+" after both sets of chips; a new source cites the family fact, as the empty pin does. */}
            {(familyCited || marriageCited) && canEdit && (
                <Cite more factLabel={kindLabel} onClick={() => onCitationClick(FACT_TABLES.FAMILIES, family.Id, kindLabel, null)} />
            )}
        </>
    );

    const noteCountFor = (ev: EventWithMedia): number => noteCounts[ev.Id] ?? ev.noteCount ?? 0;
    const notesRail = (ev: EventWithMedia) => (
        <OwnerNotesCard
            ownerTable="Events"
            ownerId={ev.Id}
            treeId={activeTreeId}
            canEdit={canEdit}
            canDelete={canDelete}
            showPreferred={false}
            onNotesChange={(notes) => setNoteCounts((prev) =>
                prev[ev.Id] === notes.length ? prev : { ...prev, [ev.Id]: notes.length })}
            header={
                <h4 className="serif text-base font-semibold m-0">
                    {tPerson('event_notes_title')} <NoteCount count={noteCountFor(ev)} />
                </h4>
            }
        />
    );

    type Row = TimelineItem & { sortKey: number | null };
    const rows: Row[] = [];

    // 1. Marriage — the "start" anchor, edited in place via InlineMarriageEditor
    // (writes to the Families columns, not an Events row).
    rows.push({
        ...(editingMarriage ? {} : markRow(`${FACT_TABLES.FAMILIES}:${family.Id}`,
            canEdit ? () => { rememberEventOpener(); setEditingMarriage(true); } : undefined)),
        key: 'marriage',
        sortKey: sortableYear(family.MarriageDate),
        icon: glyphIcon('MARR'),
        title: <>{t('started')} <span className="muted font-normal">· {kindLabel}</span></>,
        meta: (
            <>
                <TimelineWhenWhere date={family.MarriageDate ? <span className="date-mono text-sm">{formatDateForDisplay(family.MarriageDate, language, dateWords)}</span> : <span className="muted">{t('date_unknown')}</span>} place={family.MarriagePlace} />
            </>
        ),
        citations: marriagePins,
        extra: (family.marriageMedia?.length ?? 0) > 0 ? (
            <>
                <EventMediaStrip media={family.marriageMedia ?? []} treeId={activeTreeId} />
                {mapExtra(family.MarriagePlace, family.MarriagePlaceId, 'marriage')}
            </>
        ) : mapExtra(family.MarriagePlace, family.MarriagePlaceId, 'marriage'),
        actions: canEdit ? <EventRowActions label={kindLabel} onEdit={() => { rememberEventOpener(); setEditingMarriage(true); }} /> : null,
        override: editingMarriage ? (
            <InlineMarriageEditor
                familyId={family.Id}
                treeId={activeTreeId}
                marriageDate={family.MarriageDate}
                marriagePlace={family.MarriagePlace}
                marriagePlaceId={family.MarriagePlaceId}
                kindLabel={kindLabel}
                canDelete={canDelete}
                relevantPersonIds={relevantPersonIds}
                onMediaChanged={onChanged}
                onCancel={() => setEditingMarriage(false)}
                onSaved={() => { setEditingMarriage(false); onChanged(); }}
            />
        ) : null,
    });

    // 2. Family events (divorce/annulment/engagement/…) — custom → edit-in-place + delete.
    for (const ev of family.events ?? []) {
        const label = familyEventLabel(ev.Type, te);
        const notesKey = `notes-fevent-${ev.Id}`;
        const notesOpen = isOpen(notesKey);
        const notesRegionId = `family-event-notes-${ev.Id}`;
        const noteTotal = noteCountFor(ev);
        const notesControl = noteTotal > 0 || notesOpen ? (
            <div className="mt-1">
                <button
                    type="button"
                    onClick={() => toggle(notesKey)}
                    className="inline-flex items-center gap-1 p-0 text-meta text-link hover:underline rounded-lg transition-colors bg-transparent border-0 cursor-pointer"
                    aria-expanded={notesOpen}
                    aria-controls={notesRegionId}
                >
                    <StickyNote width="11" height="11" aria-hidden="true" />
                    {notesOpen ? tPerson('event_notes_hide', { count: noteTotal }) : tPerson('event_notes_show', { count: noteTotal })}
                </button>
                {notesOpen && <div className="mt-2" id={notesRegionId}>{notesRail(ev)}</div>}
            </div>
        ) : null;
        rows.push({
            ...(editingId === ev.Id ? {} : markRow(`${FACT_TABLES.EVENTS}:${ev.Id}`,
                canEdit ? () => { rememberEventOpener(); setEditingId(ev.Id); } : undefined)),
            key: `fevent-${ev.Id}`,
            sortKey: sortableYear(ev.Date),
            icon: glyphIcon(ev.Type),
            dim: eventGlyph(ev.Type).dim,
            title: label,
            meta: (
                <>
                    <TimelineWhenWhere date={ev.Date ? <span className="date-mono text-sm">{formatDateForDisplay(ev.Date, language, dateWords)}</span> : <span className="muted">{t('date_unknown')}</span>} place={ev.Place} />
                </>
            ),
            citations: citePins(FACT_TABLES.EVENTS, ev.Id, label),
            note: ev.Description,
            extra: (
                <>
                    <EventMediaStrip media={ev.media ?? []} treeId={activeTreeId} />
                    {mapExtra(ev.Place, ev.PlaceId, `fevent-${ev.Id}`)}
                    {notesControl}
                </>
            ),
            actions: canEdit ? <EventRowActions label={label} onEdit={() => { rememberEventOpener(); setEditingId(ev.Id); }} onDelete={canDelete ? () => setConfirmDelete(ev) : undefined} /> : null,
            override: editingId === ev.Id ? (
                <InlineEventEditor
                    target={{ kind: 'family', familyId: family.Id }}
                    event={ev}
                    relevantPersonIds={relevantPersonIds}
                    onCancel={() => setEditingId(null)}
                    onRefresh={onChanged}
                    onSaved={() => { setEditingId(null); onChanged(); }}
                    onDelete={canDelete ? () => setConfirmDelete(ev) : undefined}
                    notesSlot={notesRail(ev)}
                />
            ) : null,
        });
    }

    // 3. Children's births (derived context: edit on the child's page, but cite
    // here, so one census can be cited on a household from its family (#799)).
    for (const child of childList) {
        const firstName = (partnerName(child) || tc('unknown')).split(' ')[0];
        rows.push({
            key: `birth-${child.Id}`,
            sortKey: sortableYear(child.BirthDate),
            icon: glyphIcon('BIRT'),
            title: <>{t('birth_label')} · {firstName} <span className="muted font-normal">({t('child_label')})</span></>,
            meta: (
                <>
                    <TimelineWhenWhere date={child.BirthDate ? <span className="date-mono text-sm">{formatDateForDisplay(child.BirthDate, language, dateWords)}</span> : <span className="muted">{t('date_unknown')}</span>} place={child.BirthPlace} />
                </>
            ),
            // Only a recorded birth: the child's page shows no birth row to carry an empty one's citation.
            citations: (child.BirthDate || child.BirthPlace) ? citePins(FACT_TABLES.PERSON_BIRTH, child.Id, `${t('birth_label')} · ${firstName}`) : null,
        });
    }

    // 3a. Children's adoptions: a child's own ADOP event, dated like any other
    // (#485). Derived context like the births: edited on the child's page.
    for (const ev of family.childAdoptions ?? []) {
        const child = childList.find((c) => c.Id === ev.PersonId);
        if (!child) continue;
        const firstName = (partnerName(child) || tc('unknown')).split(' ')[0];
        const label = `${familyEventLabel('ADOP', te)} · ${firstName}`;
        rows.push({
            key: `adop-${ev.Id}`,
            sortKey: sortableYear(ev.Date),
            icon: glyphIcon('ADOP'),
            title: <>{familyEventLabel('ADOP', te)} · {firstName} <span className="muted font-normal">({t('child_label')})</span></>,
            meta: (
                <>
                    <TimelineWhenWhere date={ev.Date ? <span className="date-mono text-sm">{formatDateForDisplay(ev.Date, language, dateWords)}</span> : <span className="muted">{t('date_unknown')}</span>} place={ev.Place} />
                </>
            ),
            citations: citePins(FACT_TABLES.EVENTS, ev.Id, label),
            note: ev.Description,
        });
    }

    // 3b. Children's deaths: every recorded one, like the births above.
    for (const child of childList) {
        if (!hasRecordedDeath(child)) continue;
        const age = calcAgeAtDeath(child.BirthDate, child.DeathDate);
        const deathLabel = t('death_of', { name: (partnerName(child) || tc('unknown')).split(' ')[0] });
        rows.push({
            key: `cdeath-${child.Id}`,
            sortKey: sortableYear(child.DeathDate),
            icon: glyphIcon('DEAT'),
            dim: true,
            title: <>{deathLabel}{age !== null && <> <span className="muted">· {t('age_label', { age })}</span></>}</>,
            meta: (
                <>
                    <TimelineWhenWhere date={child.DeathDate && <span className="date-mono text-sm">{formatDateForDisplay(child.DeathDate, language, dateWords)}</span>} place={child.DeathPlace} />
                </>
            ),
            citations: citePins(FACT_TABLES.PERSON_DEATH, child.Id, deathLabel),
        });
    }

    // 4. Inferred "ended" from a partner's death — only when no divorce/annulment/separation event exists,
    //    and never when that death falls before the start (#826: it's a bad date, not an end).
    const hasEndEvent = (family.events ?? []).some(e => ['DIV', 'DIVF', 'ANUL', 'SEPA'].includes(e.Type));
    if (earlierPartner && !hasEndEvent && !derivedEndPrecedesStart(earlierPartner.DeathDate, family.MarriageDate)) {
        rows.push({
            key: 'ended',
            sortKey: sortableYear(earlierPartner.DeathDate),
            icon: glyphIcon('DEAT'),
            dim: true,
            title: <>{t('partnership_ended')} <span className="muted">· {t('cause_death_of', { name: (partnerName(earlierPartner) || tc('unknown')).split(' ')[0] })}</span></>,
            meta: (
                <>
                    <TimelineWhenWhere date={earlierPartner.DeathDate && <span className="date-mono text-sm">{formatDateForDisplay(earlierPartner.DeathDate, language, dateWords)}</span>} place={earlierPartner.DeathPlace} />
                </>
            ),
        });
    }

    // Undated rows sink to the end rather than sitting at year zero ahead of every date.
    rows.sort((a, b) => (a.sortKey ?? Infinity) - (b.sortKey ?? Infinity));

    async function handleDelete() {
        const ev = confirmDelete;
        if (!ev) return;
        setConfirmDelete(null);
        setEditingId(cur => (cur === ev.Id ? null : cur));
        try {
            const client = await getDataClient();
            await client.events.remove(ev.Id, activeTreeId);
            onChanged();
        } catch {
            // A failed delete leaves the row intact; errors surface via the data layer.
        }
    }

    return (
        <div className="card card-pad mb-[18px]" ref={eventsRef} tabIndex={-1}>
            <Timeline items={rows} />
            {footer && <div className="-mx-4 -mb-4 mt-3 border-t border-border-light">{footer}</div>}
            {confirmDelete && (
                <ConfirmDialog
                    open
                    variant="calm"
                    tone="danger"
                    title={te('event_delete_confirm_title')}
                    body={
                        <>
                            <span className="font-semibold" style={{ color: 'var(--text)' }}>{eventLabel(confirmDelete)}</span>
                            <div className="mt-2 text-meta" style={{ color: 'var(--text-muted)' }}>{te('event_delete_audit_note')}</div>
                        </>
                    }
                    confirmLabel={tc('delete')}
                    onConfirm={handleDelete}
                    onCancel={() => setConfirmDelete(null)}
                />
            )}
        </div>
    );
}

export function ChildrenList({
    childList, partner1 = null, partner2 = null, treeId, familyId, canEdit, canDelete, onChanged,
}: {
    childList: PartnerPerson[];
    /** The family's partners, for each child's relationship to each (#982). */
    partner1?: PartnerPerson | null;
    partner2?: PartnerPerson | null;
    treeId: number | null;
    familyId: number;
    /** Add a child and retype a link: every rung but 'view'. */
    canEdit: boolean;
    /** Remove and Move…: the delete rung (owner/edit), as the services require (#848). */
    canDelete: boolean;
    onChanged: () => void;
}) {
    const t = useTranslations('families');
    const tf = useTranslations('editFamily');
    const tCommon = useTranslations('common');
    const { activeTreeId } = useTree();
    const [confirmRemove, setConfirmRemove] = useState<{ id: number; name: string } | null>(null);
    const offerUndo = useUndoRemoval(activeTreeId);
    const [busy, setBusy] = useState(false);
    // The collections pattern (#760): one row's inline panel at a time, or the add panel.
    const [editingId, setEditingId] = useState<number | null>(null);
    // The edited child's relationship to each partner; '' is "Not recorded".
    const [draft, setDraft] = useState<{ partner1: ChildRelationshipType | ''; partner2: ChildRelationshipType | '' }>({ partner1: '', partner2: '' });
    const bothPartners = partner1 != null && partner2 != null;
    // With one partner, the one select shows that partner's slot and sets both.
    const shownSlots = bothPartners ? (['partner1', 'partner2'] as const) : partner1 == null && partner2 != null ? (['partner2'] as const) : (['partner1'] as const);
    const [adding, setAdding] = useState(false);
    const [movingId, setMovingId] = useState<number | null>(null);
    const addRef = useReturnFocus(adding);
    const listRef = useRef<HTMLDivElement>(null);
    const rememberRowOpener = useEditorFocusReturn(editingId !== null || movingId !== null, listRef);
    const addPickerRef = useRef<PersonPickerHandle>(null);
    // Add child opens straight into its search (#796, ED-8).
    useEffect(() => { if (adding) addPickerRef.current?.focus(); }, [adding]);

    async function changeType(childId: number, rel: ChildRelationships) {
        setBusy(true);
        try {
            const client = await getDataClient();
            await client.families.updateChildType(familyId, childId, rel, activeTreeId);
            setEditingId(null);
            onChanged();
        } catch { /* data layer surfaces errors */ } finally {
            setBusy(false);
        }
    }
    async function addChild(childId: number) {
        try {
            const client = await getDataClient();
            await client.families.addChild(familyId, childId, 'Birth', activeTreeId);
            setAdding(false);
            onChanged();
        } catch { /* surfaced by data layer */ }
    }
    async function doMove(child: { id: number; name: string }, to: { id: number; label: string }) {
        setBusy(true);
        try {
            const client = await getDataClient();
            const change = await client.families.moveChild(familyId, child.id, to.id, activeTreeId);
            setMovingId(null);
            onChanged();
            // One audit entry for the whole move, so one Undo puts it back.
            offerUndo(change, tCommon('toast_child_moved', { name: child.name, family: to.label }), onChanged);
        } catch { /* surfaced by data layer */ } finally {
            setBusy(false);
        }
    }
    async function doRemove() {
        if (!confirmRemove) return;
        setBusy(true);
        try {
            const client = await getDataClient();
            const change = await client.families.removeChild(familyId, confirmRemove.id, activeTreeId);
            onChanged();
            // The removal is audited; Undo reverts that entry (#788).
            offerUndo(change, tCommon('toast_child_removed', { name: confirmRemove.name }), onChanged);
        } catch { /* surfaced by data layer */ } finally {
            setBusy(false);
            setConfirmRemove(null);
        }
    }

    return (
        <div className="card" ref={listRef} tabIndex={-1}>
            {childList.length === 0 ? (
                <div className="muted py-6 px-4 text-center text-sm">{t('no_children_partnership')}</div>
            ) : (
                childList.map((c, i) => {
                    const name = partnerName(c) || tCommon('unknown');
                    const ageAtDeath = calcAgeAtDeath(c.BirthDate, c.DeathDate);
                    const diedYoung = ageAtDeath !== null && ageAtDeath < 18;
                    // A stored value outside the set shows "Not recorded" in the editor
                    // rather than claiming a type we don't hold; choosing an offered
                    // type and saving is the only thing that writes.
                    const stored = (v: string | null | undefined): ChildRelationshipType | '' => (isChildRelationshipType(v) ? v : '');
                    // Read-mode label for a non-birth link (#982). Birth stays
                    // unlabelled: it is the default, and tagging every row adds noise.
                    const relLabel = childRelationshipTags(c, partner1, partner2)
                        .map((tag) => tag.name
                            ? tf(`rel_of_${tag.type.toLowerCase()}`, { name: tag.name })
                            : tf(`rel_${tag.type.toLowerCase()}`))
                        .join(' · ') || null;
                    const border = i < childList.length - 1 || canEdit ? 'border-b border-b-[color:var(--border-light)]' : '';
                    const editing = editingId === c.Id;
                    const moving = movingId === c.Id;
                    return (
                        <div key={c.Id} className={border}>
                            <div className="row-host row items-center relative">
                                <Link
                                    href={`/people/view?id=${c.Id}`}
                                    className="row row-lift gap-3 py-3 px-4 no-underline flex-1 min-w-0"
                                    style={{ color: 'inherit' }}
                                    onMouseEnter={() => prefetchPerson(c.Id, treeId)}
                                    onFocus={() => prefetchPerson(c.Id, treeId)}
                                >
                                    <span className="muted tabular-nums text-meta w-5.5 shrink-0">{i + 1}.</span>
                                    <PersonAvatar mediaId={c.PrimaryMediaId} treeId={treeId} name={name} initials={getInitials(c.FirstName, c.LastName)} sex={c.Sex} size={36} focalX={c.FocalX} focalY={c.FocalY} focalRadius={c.FocalRadius} />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-base">
                                            {name}{' '}
                                            {relLabel && <Badge tone="outline" className="ml-1 font-normal">{relLabel}</Badge>}
                                        </div>
                                        {/* An age at death is a fact, so it's text on the life-span line,
                                            not a grey tag (#808, CL-3). */}
                                        <div className="text-meta">
                                            <Lifespan
                                                birth={c.BirthDate}
                                                death={c.DeathDate}
                                                status={livingStatus(c)}
                                            />
                                            {diedYoung && <span className="text-text-muted">{' · '}{t('died_age', { age: ageAtDeath })}</span>}
                                        </div>
                                    </div>
                                </Link>
                                {canEdit && !editing && !moving && (
                                    <div className="pr-3 shrink-0">
                                        <RowActions
                                            editLabel={tCommon('edit_named', { name })}
                                            onEdit={() => { rememberRowOpener(); setEditingId(c.Id); setDraft({ partner1: stored(c.Partner1Relationship), partner2: stored(c.Partner2Relationship) }); setAdding(false); setMovingId(null); }}
                                            deleteText={tf('remove')}
                                            deleteLabel={tCommon('remove_named', { name })}
                                            onDelete={canDelete ? () => setConfirmRemove({ id: c.Id, name }) : undefined}
                                            disabled={busy}
                                        >
                                            {canDelete && (
                                                <RowAction
                                                    icon={<ArrowLeftRight size={13} aria-hidden="true" />}
                                                    label={t('move_child')}
                                                    ariaLabel={t('move_child_named', { name })}
                                                    title={t('move_child_title')}
                                                    onClick={() => { rememberRowOpener(); setMovingId(c.Id); setEditingId(null); setAdding(false); }}
                                                    disabled={busy}
                                                />
                                            )}
                                        </RowActions>
                                    </div>
                                )}
                            </div>
                            {moving && (
                                <MoveChildPanel
                                    childName={name}
                                    familyId={familyId}
                                    treeId={activeTreeId}
                                    busy={busy}
                                    onPick={(to) => doMove({ id: c.Id, name }, to)}
                                    onCancel={() => setMovingId(null)}
                                />
                            )}
                            {editing && (
                                <div className="inline-panel mx-3 mb-3 flex flex-col gap-3" role="group" aria-label={tCommon('edit_named', { name })} onKeyDown={escapeToCancel(() => setEditingId(null))}>
                                    {/* One relationship per partner when there are two (#982); with
                                        one partner, the one value covers both slots. */}
                                    {shownSlots.map((slot) => (
                                        <Select
                                            key={slot}
                                            className="self-start"
                                            label={bothPartners
                                                ? tf('relationship_to', { name: partnerShortName(slot === 'partner1' ? partner1 : partner2) || tCommon('unknown') })
                                                : tf('relationship_type')}
                                            valueLabel={draft[slot] ? tf(`rel_${draft[slot].toLowerCase()}`) : tf('rel_unrecorded')}
                                            options={CHILD_RELATIONSHIP_TYPE_VALUES.map((rt) => ({ key: rt, value: rt, label: tf(`rel_${rt.toLowerCase()}`) }))}
                                            isSelected={(v) => v === draft[slot]}
                                            onSelect={(v) => setDraft((d) => (bothPartners ? { ...d, [slot]: v } : { partner1: v, partner2: v }))}
                                        />
                                    ))}
                                    <EditorActions
                                        size="sm"
                                        onSave={() => draft.partner1 && draft.partner2 && changeType(c.Id, { partner1: draft.partner1, partner2: draft.partner2 })}
                                        onCancel={() => setEditingId(null)}
                                        saving={busy}
                                        saveDisabled={!draft.partner1 || !draft.partner2}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })
            )}
            {canEdit && (adding ? (
                <div className="inline-panel m-3 flex flex-col gap-3" role="group" aria-label={tf('add_child')} data-testid="add-child-picker" onKeyDown={escapeToCancel(() => setAdding(false))}>
                    <PersonPicker ref={addPickerRef} value={null} onChange={(pp) => pp && addChild(pp.Id)} showSex showDates excludeIds={childList.map((c) => c.Id)} treeId={activeTreeId} placeholder={tf('search_child_placeholder')} inline />
                    <div className="row gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>{tCommon('cancel')}</Button>
                    </div>
                </div>
            ) : (
                <AddRow ref={addRef} label={tf('add_child')} onClick={() => { setAdding(true); setEditingId(null); setMovingId(null); }} className="rounded-b-card" />
            ))}
            {confirmRemove && (
                <ConfirmDialog open variant="calm" tone="danger" title={t('remove_child_q')} body={t('remove_child_q_body', { name: confirmRemove.name })} confirmLabel={tCommon('remove')} cancelLabel={tCommon('cancel')} busy={busy} onConfirm={doRemove} onCancel={() => setConfirmRemove(null)} />
            )}
        </div>
    );
}

export function OtherPartnerships({ pf, currentFamilyId, treeId }: { pf: PartnerFamilies | null; currentFamilyId: number; treeId: number | null }) {
    const t = useTranslations('families');
    const tCommon = useTranslations('common');
    if (!pf || !pf.person) return null;
    // Each spouse relation already carries the OTHER partner (pf.person's spouse) and its family.
    // Undated/phrase-only marriages sink last rather than to year zero (#490).
    const sorted = [...pf.spouses].sort((a, b) => compareSortableYears(a.family.MarriageDate, b.family.MarriageDate));
    return (
        <>
            <div className="eyebrow pt-3 px-3.5 pb-1.5">
                {t('for_partner', { name: partnerName(pf.person) || tCommon('unknown') })}
            </div>
            {sorted.length === 0 ? (
                <div className="muted pt-0 px-3.5 pb-3 text-meta">{t('no_other_partnerships')}</div>
            ) : (
                sorted.map((s, i) => {
                    const isCurrent = s.family.Id === currentFamilyId;
                    const otherName = partnerName(s.person) || tCommon('unknown');
                    const ya = yearOnly(s.family.MarriageDate);
                    return (
                        <div
                            key={s.family.Id}
                            className={`py-2 px-3.5 text-sm border-b border-b-[color:var(--border-light)] ${i === 0 ? 'border-t border-t-[color:var(--border-light)]' : ''}`}
                            style={{ background: isCurrent ? 'var(--card-alt)' : 'transparent' }}
                        >
                            <div className="row justify-between gap-2">
                                {isCurrent ? (
                                    <span className="font-medium flex-1">
                                        {sorted.length > 1 ? `${i + 1}. ` : ''}{t('with_partner', { name: otherName })}
                                    </span>
                                ) : (
                                    <Link
                                        href={`/families/view?id=${s.family.Id}`}
                                        className="font-medium flex-1 no-underline text-link hover:underline"
                                        style={{ color: 'inherit' }}
                                        onMouseEnter={() => prefetchFamily(s.family.Id, treeId)}
                                        onFocus={() => prefetchFamily(s.family.Id, treeId)}
                                    >
                                        {sorted.length > 1 ? `${i + 1}. ` : ''}{t('with_partner', { name: otherName })}
                                    </Link>
                                )}
                                <span className="date-mono date-muted text-meta">{ya || '—'}</span>
                            </div>
                            {isCurrent && (
                                <div className="muted text-xs mt-0.5">{t('viewing_this')}</div>
                            )}
                        </div>
                    );
                })
            )}
        </>
    );
}
