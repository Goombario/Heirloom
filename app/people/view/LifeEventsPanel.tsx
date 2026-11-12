'use client';

import React, { useId, useRef, useState } from 'react';
import { useEditorFocusReturn } from '@/app/hooks/useEditorFocusReturn';
import { useTranslations } from 'next-intl';
import { MapPin, StickyNote } from '@/lib/icons';
import type { PersonWithRelations, GedcomEvent, EventWithMedia, PersonGalleryMedia } from '@/lib/db/schema';
import { EVENT_TYPES, getEventDisplayType } from '@/lib/db/schema';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { formatDateForDisplay, sortableYear } from '@/lib/date-utils';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import LocationMap from '@/app/components/LocationMap';
import { useToggleSet } from '@/app/hooks/useToggleSet';
import { Timeline, TimelineWhenWhere, type TimelineItem } from '@/app/components/Timeline';
import { eventGlyph } from '@/app/components/eventGlyph';
import { compareTimelineItems, eventIsBirth, eventIsDeath, shouldRenderColumnBirth, shouldRenderColumnDeath } from './derive';
import { EventRowActions } from '@/app/components/EventRowActions';
import { useTimelineMarks, type DataCheckMarks } from '@/app/components/data-checks/marks';
import EventMediaStrip from '@/app/components/media/EventMediaStrip';
import InlineEventEditor from '@/app/components/InlineEventEditor';
import { OwnerNotesCard, NoteCount, visibleNotes } from '@/app/components/notes/OwnerNotesCard';
import type { Note, NoteOwnerFact } from '@/lib/data/types';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { getDataClient } from '@/lib/data';
import { useTree } from '@/app/contexts/TreeContext';
import { vitalDeletePatchFor } from '@/app/components/person-form/vitalEvent';
import { factPlaceEntry } from '@/lib/places/place-key';
import type { RunChange } from './mobile/useChange';
import { displayFullName } from '@/lib/utils/names';

interface LifeEventsPanelProps {
    person: PersonWithRelations;
    language: string;
    renderCitePin: (factTable: string, factId: number, factLabel: string) => React.ReactNode;
    tTypes: ReturnType<typeof useTranslations>;
    placeCoords: Record<string, { lat: number; lng: number }>;
    /** Show the per-row edit/delete affordances (owner/edit permission). */
    canEdit: boolean;
    /** Permit destructive note deletion in the event-note rails. */
    canDelete: boolean;
    /** Refresh the person after an edit/delete (parent re-fetches). */
    onChanged: () => void;
    /**
     * The person's FULL note list, as the detail page's rail already reported it —
     * fact-scoped rows included, which that rail no longer displays. Only used to seed
     * the Birth/Death rows' note counts, so the toggle can say "Show notes (2)" without
     * this panel opening a fetch of its own. Empty until the rail's first load lands.
     */
    personNotes: Note[];
    /**
     * The person's gallery, as the page already loaded it. The Birth and Death rows
     * show the photos linked to that fact (ADR 0030) from it, with no fetch here.
     */
    personMedia?: PersonGalleryMedia[];
    /** Reload the gallery after a Birth or Death editor adds or removes a photo. */
    onMediaChanged?: () => void;
    /**
     * The list's last row (#760): the trailing "Add event" row, or the inline panel
     * it opened. Rendered inside the card under a hairline.
     */
    footer?: React.ReactNode;
    /** This person's dates to check (#833): a mark on each row whose date to fix it is. */
    marks?: DataCheckMarks;
    /**
     * The v1.1 desktop page's change runner (#49): deletes act at once and offer Undo,
     * like mobile. Without it a delete asks first.
     */
    run?: RunChange;
}

export function LifeEventsPanel({ person, language, renderCitePin, tTypes, placeCoords, canEdit, canDelete, onChanged, personNotes, personMedia, onMediaChanged, footer, marks, run }: LifeEventsPanelProps) {
    const t = useTranslations('personDetail');
    const tc = useTranslations('common');
    const te = useTranslations('eventEdit');
    const tDesk = useTranslations('personDesktop');
    const tm = useTranslations('mobileEvents');
    const { activeTreeId } = useTree();
    const dateWords = useDateQualifierWords();
    const { isOpen, toggle } = useToggleSet();
    // Namespaces the disclosure region ids below, so two panels on one page (a
    // person and, one day, a spouse) cannot mint the same id from the same
    // timeline key.
    const idPrefix = `${useId()}-`;
    const [editingId, setEditingId] = useState<number | null>(null);
    // Intrinsic Birth/Death edit inline too — they have no Events row Id, so a
    // separate 'BIRT' | 'DEAT' key tracks which vital row is currently editing.
    const [editingVital, setEditingVital] = useState<'BIRT' | 'DEAT' | null>(null);
    // Back to the row's Edit (or the panel, if the row was deleted) on close (#798).
    const panelRef = useRef<HTMLDivElement>(null);
    const rememberOpener = useEditorFocusReturn(editingId !== null || editingVital !== null, panelRef);
    const [confirmDelete, setConfirmDelete] = useState<GedcomEvent | null>(null);
    // The desktop page keeps the marks on the page: no Open in Data checks link (#49).
    const markRow = useTimelineMarks(marks, { dataChecksLink: !run });
    // Live note counts per event, keyed by Events."Id". Seeded lazily: the count
    // that arrives with the person payload (`ev.noteCount`, one batched query — no
    // per-row fetch) is authoritative until a rail on this page adds or deletes a
    // note, after which its own report wins so the row's affordance and the rail's
    // heading never disagree with what the user just did.
    const [noteCounts, setNoteCounts] = useState<Record<number, number>>({});
    // The same idea for the intrinsic Birth/Death rows, which have no Events row to key
    // on. Seeded from `personNotes` (already fetched by the page's rail), overridden by
    // whichever vital rail last reported — so a note the user just added or deleted wins
    // over the seed, exactly as it does for an event row.
    const [vitalNoteCounts, setVitalNoteCounts] = useState<Partial<Record<NoteOwnerFact, number>>>({});
    // Intrinsic Birth/Death have no Events row to delete — "deleting" clears the
    // People columns (Option A). Tracked separately from custom-event deletes.
    const [confirmDeleteVital, setConfirmDeleteVital] = useState<'BIRT' | 'DEAT' | null>(null);

    type Item = {
        key: string;
        sortKey: number | null;
        type: string;
        title: string;
        date: string | null;
        place: string | null;
        /** The place the fact points at (#1186): two places may share its name. */
        placeId: number | null;
        description: string | null;
        modifier: '' | 'acc' | 'dim';
        citation: React.ReactNode;
        /** The underlying Events row (with attached media) — custom events only (intrinsic Birth/Death have none). */
        event?: EventWithMedia;
        /** Birth/Death are derived from the profile columns, not Events rows → Edit
         *  routes the inline save back to those columns (Option A), never an Events row. */
        isIntrinsic: boolean;
        /**
         * A relative's event shown read-only here (#49): a marriage or partnership
         * start, or the birth of this person's child. It links to where it is edited.
         */
        relative?: { href: string };
    };

    const items: Item[] = [];

    /**
     * Whether the person carries notes scoped to this vital. Such a note is readable
     * ONLY on its intrinsic row, so the row has to exist for it — otherwise a GEDCOM
     * `1 BIRT` with a `2 NOTE` and no DATE or PLAC (which promotes to empty Birth
     * columns) would import a note that is then visible nowhere in the app. The row
     * renders dateless and placeless in that case, carrying just its notes.
     *
     * It does NOT override the duplicate guard: when a real BIRT/DEAT Events row
     * exists, that row is the timeline's birth and the intrinsic one stays suppressed
     * rather than drawing a second "Birth" beside it.
     */
    const hasVitalNotes = (fact: NoteOwnerFact): boolean =>
        visibleNotes(personNotes, fact).length > 0;
    const hasRealVitalEvent = (type: 'BIRT' | 'DEAT'): boolean =>
        (person.events ?? []).some((e) => e.Type === type);

    if (shouldRenderColumnBirth(person) || (hasVitalNotes('Birth') && !hasRealVitalEvent('BIRT'))) {
        items.push({
            key: 'birth',
            sortKey: sortableYear(person.BirthDate),
            type: 'BIRT',
            title: tTypes('BIRT'),
            date: person.BirthDate,
            place: person.BirthPlace,
            placeId: person.BirthPlaceId ?? null,
            description: null,
            modifier: 'acc',
            citation: renderCitePin(FACT_TABLES.PERSON_BIRTH, person.Id, t('fact_birth')),
            isIntrinsic: true,
        });
    }

    for (const ev of person.events ?? []) {
        const isDeath = eventIsDeath(ev.Type);
        items.push({
            key: `event-${ev.Id}`,
            sortKey: sortableYear(ev.Date),
            type: ev.Type,
            title: getEventDisplayType(ev.Type),
            date: ev.Date,
            place: ev.Place,
            placeId: ev.PlaceId ?? null,
            description: ev.Description,
            modifier: eventIsBirth(ev.Type) ? 'acc' : isDeath ? 'dim' : '',
            citation: renderCitePin(FACT_TABLES.EVENTS, ev.Id, EVENT_TYPES[ev.Type] ? tTypes(ev.Type as Parameters<typeof tTypes>[0]) : getEventDisplayType(ev.Type)),
            event: ev,
            isIntrinsic: false,
        });
    }

    if (shouldRenderColumnDeath(person) || (hasVitalNotes('Death') && !hasRealVitalEvent('DEAT'))) {
        items.push({
            key: 'death',
            sortKey: sortableYear(person.DeathDate),
            type: 'DEAT',
            title: tTypes('DEAT'),
            date: person.DeathDate,
            place: person.DeathPlace,
            placeId: person.DeathPlaceId ?? null,
            description: person.DeathCause ?? null,
            modifier: 'dim',
            citation: renderCitePin(FACT_TABLES.PERSON_DEATH, person.Id, t('fact_death')),
            isIntrinsic: true,
        });
    }

    // Relatives' events (#49): marriages and partnership starts, and the births of
    // this person's children whatever the link, except a step-child who comes only
    // through a partner. Never a relative's death. Read-only, and never counted.
    for (const s of person.spouses ?? []) {
        const f = s.family;
        const partnerName = s.person ? displayFullName(s.person) || tc('unknown') : null;
        if (f.MarriageDate || f.MarriagePlace) {
            const married = f.Type == null || f.Type === 'Marriage';
            items.push({
                key: `family-${f.Id}`,
                sortKey: sortableYear(f.MarriageDate),
                type: 'MARR',
                title: partnerName
                    ? tDesk(married ? 'rel_marriage_to' : 'rel_partnership_with', { name: partnerName })
                    : tDesk(married ? 'rel_marriage' : 'rel_partnership'),
                date: f.MarriageDate,
                place: f.MarriagePlace,
                placeId: f.MarriagePlaceId ?? null,
                description: null,
                modifier: '',
                citation: null,
                isIntrinsic: false,
                relative: { href: `/families/view?id=${f.Id}` },
            });
        }
        const slot = f.Partner1Id === person.Id ? 'Partner1Relationship' : 'Partner2Relationship';
        for (const c of s.children ?? []) {
            if (c.Id === person.Id || c[slot] === 'Step' || (!c.BirthDate && !c.BirthPlace)) continue;
            items.push({
                key: `child-${c.Id}`,
                sortKey: sortableYear(c.BirthDate),
                type: 'BIRT',
                title: tDesk('rel_birth_of', { name: displayFullName(c) || tc('unknown') }),
                date: c.BirthDate,
                place: c.BirthPlace,
                placeId: c.BirthPlaceId ?? null,
                description: null,
                modifier: '',
                citation: null,
                isIntrinsic: false,
                relative: { href: `/people/view?id=${c.Id}` },
            });
        }
    }

    items.sort(compareTimelineItems);

    if (items.length === 0) {
        return (
            /* The diagonal hatch this used to carry read as a disabled/placeholder
               treatment rather than an empty state, and matched nothing else in the
               app (#429). Plain card + centred text, the same shape the gallery and
               relationships empty states use. */
            <div className="card">
                <div className="p-9" style={{ textAlign: 'center' }}>
                    <div className="serif text-lg font-semibold mb-1.5">{t('no_events_title')}</div>
                    <p className="muted text-sm mb-0">
                        {t('no_events_desc')}
                    </p>
                </div>
                {footer && <div className="border-t border-border-light">{footer}</div>}
            </div>
        );
    }

    const birthYear = sortableYear(person.BirthDate);

    /** How many notes this event has: what a rail on this page last reported, else
     *  the count that came with the person payload. */
    const noteCountFor = (ev: EventWithMedia): number => noteCounts[ev.Id] ?? ev.noteCount ?? 0;

    /**
     * The notes rail for one event, used by BOTH mounts below (the read
     * disclosure and the edit-in-place body). `canEdit` is the panel's own
     * permission prop, so a view-only reader gets the card's read-only rendering
     * — no composer, no ⋯ menu, no delete — rather than a second renderer.
     */
    const notesRail = (ev: EventWithMedia) => (
        <OwnerNotesCard
            ownerTable="Events"
            ownerId={ev.Id}
            treeId={activeTreeId}
            canEdit={canEdit}
            canDelete={canDelete}
            // Nothing reads an event note's IsPrimary — only the person hero quotes a
            // preferred note, and it quotes the PERSON's.
            showPreferred={false}
            onNotesChange={(notes) => setNoteCounts((prev) =>
                prev[ev.Id] === notes.length ? prev : { ...prev, [ev.Id]: notes.length })}
            header={
                <h4 className="serif text-base font-semibold m-0">
                    {t('event_notes_title')} <NoteCount count={noteCountFor(ev)} />
                </h4>
            }
        />
    );

    /** How many notes this vital has: what its rail last reported, else the seed. */
    const vitalNoteCountFor = (fact: NoteOwnerFact): number =>
        vitalNoteCounts[fact] ?? visibleNotes(personNotes, fact).length;

    /**
     * The notes rail for an intrinsic Birth/Death row. These are notes on the PERSON
     * carrying `NoteLink."OwnerFact"` — what a GEDCOM `1 BIRT` / `2 NOTE` imports as —
     * so the owner is the person, not an Events row (there is none). Scoping the card
     * to the fact both filters it to these notes and makes the composer create new ones
     * already scoped, so they come back here rather than falling into the person's
     * general rail.
     */
    const vitalNotesRail = (fact: NoteOwnerFact) => (
        <OwnerNotesCard
            ownerTable="People"
            ownerId={person.Id}
            treeId={activeTreeId}
            canEdit={canEdit}
            canDelete={canDelete}
            factScope={fact}
            showPreferred={false}
            // The report is the person's WHOLE list, so it is narrowed to this fact
            // before it becomes this row's count.
            onNotesChange={(notes) => setVitalNoteCounts((prev) => {
                const next = visibleNotes(notes, fact).length;
                return prev[fact] === next ? prev : { ...prev, [fact]: next };
            })}
            header={
                <h4 className="serif text-base font-semibold m-0">
                    {fact === 'Birth' ? t('birth_notes_title') : t('death_notes_title')} <NoteCount count={vitalNoteCountFor(fact)} />
                </h4>
            }
        />
    );

    /** The note scope an intrinsic row carries, or null for a real Events row. */
    const factOf = (item: Item): NoteOwnerFact | null =>
        !item.isIntrinsic ? null : item.type === 'BIRT' ? 'Birth' : item.type === 'DEAT' ? 'Death' : null;

    /** "Occupation · About 1911 · Deptford" — for the delete confirm + aria labels.
     *  The date reads as the row shows it, not as stored ("ABT 1911"), and the type
     *  is translated like the row title (#901). */
    const eventLabel = (ev: GedcomEvent): string =>
        [
            EVENT_TYPES[ev.Type] ? tTypes(ev.Type as Parameters<typeof tTypes>[0]) : getEventDisplayType(ev.Type),
            ev.Date && formatDateForDisplay(ev.Date, language, dateWords),
            ev.Place,
        ].filter(Boolean).join(' · ');

    /** A relative's row: its title leaves for the record it is edited on (↗). */
    const relativeRow = (item: Item): TimelineItem => {
        const { Icon } = eventGlyph(item.type);
        const age = birthYear !== null && item.sortKey !== null ? item.sortKey - birthYear : null;
        const ageLabel = age != null && age > 0 ? String(age) : '';
        return {
            key: item.key,
            icon: <Icon size={15} strokeWidth={2} aria-hidden="true" />,
            title: item.title,
            href: item.relative!.href,
            ageLabel,
            ageTitle: ageLabel ? t('age_at_event_title', { age: ageLabel }) : undefined,
            meta: (item.date || item.place) ? (
                <TimelineWhenWhere
                    date={item.date && <span className="date-mono text-sm">{formatDateForDisplay(item.date, language, dateWords)}</span>}
                    place={item.place}
                />
            ) : null,
        };
    };

    const timelineItems: TimelineItem[] = items.map((item) => {
        if (item.relative) return relativeRow(item);
        // Translate the event title where a localized label exists.
        let displayTitle = item.title;
        try {
            if (EVENT_TYPES[item.type]) {
                const translated = tTypes(item.type as Parameters<typeof tTypes>[0]);
                if (translated && translated !== item.type) displayTitle = translated;
            }
        } catch {
            // fall back to the default title
        }

        const { Icon, dim } = eventGlyph(item.type);

        // Age track — the person's age at the event (blank for birth / pre-birth).
        const age = birthYear !== null && item.sortKey !== null ? item.sortKey - birthYear : null;
        const ageLabel = age != null && age > 0 ? String(age) : '';
        const ageTitle = ageLabel ? t('age_at_event_title', { age: ageLabel }) : undefined;

        const itemPlaceCoords = factPlaceEntry(placeCoords, item.place, item.placeId);
        const mapOpen = isOpen(item.key);

        // Null when the row has neither, so the timeline doesn't render an empty
        // meta line. TimelineWhenWhere keeps "·" off both line ends (#808).
        const meta = (item.date || item.place) ? (
            <TimelineWhenWhere
                date={item.date && <span className="date-mono text-sm">{formatDateForDisplay(item.date, language, dateWords)}</span>}
                place={item.place}
            />
        ) : null;

        const itemMediaFact = factOf(item);
        const eventMedia = itemMediaFact
            ? (personMedia ?? []).filter((m) => m.OwnerFacts?.includes(itemMediaFact))
            : item.event?.media ?? [];
        // `aria-expanded` alone tells a screen reader that something opened but
        // not WHAT: `aria-controls` plus a matching id on the revealed region is
        // the other half. Both disclosures on the row get it, not just the notes
        // one — a row whose two adjacent toggles behaved differently would be
        // worse than either state.
        const mapRegionId = `${idPrefix}map-${item.key}`;
        const mapControl = itemPlaceCoords ? (
            <>
                <button
                    type="button"
                    onClick={() => toggle(item.key)}
                    className="inline-flex items-center gap-1 p-0 text-meta text-link hover:underline rounded-lg transition-colors bg-transparent border-0 cursor-pointer"
                    aria-expanded={mapOpen}
                    aria-controls={mapRegionId}
                >
                    <MapPin width="11" height="11" aria-hidden="true" />
                    {mapOpen ? tc('hide_map') : tc('show_map')}
                </button>
                {mapOpen && (
                    <div className="mt-2" id={mapRegionId}>
                        <LocationMap
                            markers={[{ lat: itemPlaceCoords.lat, lng: itemPlaceCoords.lng, label: item.place! }]}
                            variant="mini"
                        />
                    </div>
                )}
            </>
        ) : null;
        // Notes attached to the Events ROW (Note + NoteLink) — what a GEDCOM
        // `2 NOTE` under an event imports as. Offered on rows that HAVE notes, for
        // every reader including view-only: the count rides in with the person
        // payload, so this costs no request until the reader opens it, and the rail
        // itself is what fetches the text. Not the editor's "Note" box, which is
        // this event's own Events."Description" — the label says so.
        const notesKey = `notes-${item.key}`;
        const notesOpen = isOpen(notesKey);
        // Birth and Death carry their notes on the PERSON, scoped by OwnerFact; every
        // other row carries them on its Events row. Either way the row owns a rail.
        const itemFact = factOf(item);
        const noteTotal = item.event ? noteCountFor(item.event) : itemFact ? vitalNoteCountFor(itemFact) : 0;
        const rowNotesRail = item.event ? notesRail(item.event) : itemFact ? vitalNotesRail(itemFact) : null;
        const notesRegionId = `${idPrefix}${notesKey}`;
        // `|| notesOpen` keeps an OPEN disclosure mounted after its last note is
        // deleted. Gating on the count alone unmounted the toggle, the region and
        // the rail in the same commit the rail was moving focus to its own add
        // affordance, dropping the keyboard user on <body>. Open, the toggle reads
        // "Hide notes (0)" over the empty rail, so a replacement can be typed
        // straight away and the disclosure the user opened can still be closed.
        const notesControl = rowNotesRail && (noteTotal > 0 || notesOpen) ? (
            // Its own block so the toggle never shares a line with the map toggle.
            <div className={mapControl ? 'mt-1' : undefined}>
                <button
                    type="button"
                    onClick={() => toggle(notesKey)}
                    className="inline-flex items-center gap-1 p-0 text-meta text-link hover:underline rounded-lg transition-colors bg-transparent border-0 cursor-pointer"
                    aria-expanded={notesOpen}
                    aria-controls={notesRegionId}
                >
                    <StickyNote width="11" height="11" aria-hidden="true" />
                    {notesOpen ? t('event_notes_hide', { count: noteTotal }) : t('event_notes_show', { count: noteTotal })}
                </button>
                {notesOpen && <div className="mt-2" id={notesRegionId}>{rowNotesRail}</div>}
            </div>
        ) : null;

        const extra = (eventMedia.length > 0 || mapControl || notesControl) ? (
            <>
                <EventMediaStrip media={eventMedia} treeId={activeTreeId} />
                {mapControl}
                {notesControl}
            </>
        ) : null;

        // Per-row actions (owner/edit only).
        let actions: React.ReactNode = null;
        if (canEdit) {
            if (item.isIntrinsic) {
                // Birth/Death now edit in place via the same InlineEventEditor,
                // routing the save to the People columns (Option A) — no deep-link.
                const vital = item.type as 'BIRT' | 'DEAT';
                actions = (
                    <EventRowActions
                        label={displayTitle}
                        onEdit={() => { rememberOpener(); setEditingVital(vital); }}
                        onDelete={canDelete ? () => requestDeleteVital(vital) : undefined}
                    />
                );
            } else if (item.event) {
                const ev = item.event;
                actions = (
                    <EventRowActions
                        label={displayTitle}
                        onEdit={() => { rememberOpener(); setEditingId(ev.Id); }}
                        onDelete={canDelete ? () => requestDelete(ev) : undefined}
                    />
                );
            }
        }

        // Edit-in-place: the row's body becomes the editor.
        let override: React.ReactNode = null;
        if (item.event && editingId === item.event.Id) {
            const ev = item.event;
            override = (
                <InlineEventEditor
                    target={{ kind: 'person', personId: person.Id }}
                    event={ev}
                    onCancel={() => setEditingId(null)}
                    onRefresh={onChanged}
                    onSaved={() => { setEditingId(null); onChanged(); }}
                    onDelete={canDelete ? () => requestDelete(ev) : undefined}
                    // The same rail, always shown while the row is open for edit — this
                    // is where a note is ADDED, including to an event that has none (so
                    // no disclosure toggle above). Inside the editor's block now, not
                    // stacked beneath it, where it read as a second notes section next
                    // to the Description field. Deliberately NOT that field, which is
                    // this event's own Events."Description"; the heading names the
                    // difference and the two are never merged.
                    notesSlot={notesRail(ev)}
                />
            );
        } else if (item.isIntrinsic && editingVital === item.type) {
            // Intrinsic Birth/Death: pre-fill a synthetic event from the person
            // columns; the vital type routes the save back to People columns.
            const vital = item.type as 'BIRT' | 'DEAT';
            const syntheticVitalEvent: GedcomEvent = {
                Id: 0, // no Events row backs an intrinsic vital
                UserId: person.UserId,
                TreeId: person.TreeId ?? null,
                Type: vital,
                Date: item.date,
                Place: item.place,
                // For a synthetic death, Description carries the cause (#480) — the
                // editor reads it back into its Cause input, never into a Note.
                Description: vital === 'DEAT' ? person.DeathCause ?? null : null,
                PersonId: person.Id,
                FamilyId: null,
            };
            override = (
                <InlineEventEditor
                    target={{ kind: 'person', personId: person.Id }}
                    event={syntheticVitalEvent}
                    vitalLock={vital}
                    onRefresh={onMediaChanged}
                    onCancel={() => setEditingVital(null)}
                    onSaved={() => { setEditingVital(null); onChanged(); }}
                    // Replaces #545's write-only "Note" box, which saved a fact-scoped
                    // note and then told the user to go read it on the person's rail —
                    // where it no longer appears. The rail lists them here instead, and
                    // is also the ONLY way to create the first one: the disclosure above
                    // this row appears only once a note exists.
                    notesSlot={itemFact ? vitalNotesRail(itemFact) : undefined}
                />
            );
        }

        // A data check's date to fix (#833). Its "Edit date" opens this row's own editor.
        const factKey = item.isIntrinsic
            ? `${item.type === 'BIRT' ? FACT_TABLES.PERSON_BIRTH : FACT_TABLES.PERSON_DEATH}:${person.Id}`
            : item.event ? `${FACT_TABLES.EVENTS}:${item.event.Id}` : null;
        const editRow = !canEdit ? undefined
            : item.isIntrinsic ? () => { rememberOpener(); setEditingVital(item.type as 'BIRT' | 'DEAT'); }
            : item.event ? () => { rememberOpener(); setEditingId(item.event!.Id); }
            : undefined;
        const marked = factKey && !override ? markRow(factKey, editRow) : {};

        return {
            ...marked,
            key: item.key,
            // "#birth", "#death", "#event-44": Home's Next steps link straight to the row (#53).
            anchor: item.key,
            icon: <Icon size={15} strokeWidth={2} aria-hidden="true" />,
            title: displayTitle,
            citations: item.citation,
            ageLabel,
            ageTitle,
            meta,
            note: item.isIntrinsic && item.type === 'DEAT' && item.description
                ? t('cause_label', { cause: item.description })
                : item.isIntrinsic
                    ? null
                    : item.description,
            extra,
            actions,
            override,
            dim: dim || item.modifier === 'dim',
        };
    });

    /**
     * Delete at once with Undo when the page gives a `run` (the v1.1 desktop page,
     * #49, like mobile); otherwise ask first. Undo reverts the delete's audit entries.
     */
    function requestDelete(ev: GedcomEvent) {
        if (!run) { setConfirmDelete(ev); return; }
        setEditingId((cur) => (cur === ev.Id ? null : cur));
        void run(async () => {
            const client = await getDataClient();
            return client.events.remove(ev.Id, activeTreeId);
        }, { message: tm('deleted', { type: typeLabel(ev.Type) }), detail: whenWhere(ev.Date, ev.Place) });
    }

    function requestDeleteVital(vital: 'BIRT' | 'DEAT') {
        if (!run) { setConfirmDeleteVital(vital); return; }
        setEditingVital((cur) => (cur === vital ? null : cur));
        const date = vital === 'BIRT' ? person.BirthDate : person.DeathDate;
        const place = vital === 'BIRT' ? person.BirthPlace : person.DeathPlace;
        void run(async () => {
            const client = await getDataClient();
            // Deleting a death sets the status to unknown (vitalDeletePatchFor); the toast says so.
            return client.people.update(person.Id, vitalDeletePatchFor(vital), activeTreeId);
        }, {
            message: vital === 'DEAT' ? tm('death_deleted_unknown') : tm('deleted', { type: tTypes('BIRT') }),
            detail: whenWhere(date, place),
        });
    }

    const typeLabel = (type: string) => (EVENT_TYPES[type] ? tTypes(type as Parameters<typeof tTypes>[0]) : getEventDisplayType(type));
    const whenWhere = (date: string | null | undefined, place: string | null | undefined) =>
        [date && formatDateForDisplay(date, language, dateWords), place?.split(',')[0]?.trim()].filter(Boolean).join(' · ') || undefined;

    async function handleDelete() {
        const ev = confirmDelete;
        if (!ev) return;
        setConfirmDelete(null);
        setEditingId((cur) => (cur === ev.Id ? null : cur));
        try {
            const client = await getDataClient();
            await client.events.remove(ev.Id, activeTreeId);
            onChanged();
        } catch {
            // The confirm closed; a failed delete leaves the row intact. Errors are
            // surfaced by the data layer's global handler.
        }
    }

    // "Delete" an intrinsic Birth/Death: clear the People columns (Option A — no
    // Events row backs it). Deleting a death also resets IsDeceased to unknown so
    // the person can't be left "deceased" with no death record to edit.
    async function handleDeleteVital() {
        const vital = confirmDeleteVital;
        if (!vital) return;
        setConfirmDeleteVital(null);
        setEditingVital((cur) => (cur === vital ? null : cur));
        try {
            const client = await getDataClient();
            await client.people.update(person.Id, vitalDeletePatchFor(vital), activeTreeId);
            onChanged();
        } catch {
            // Errors surfaced by the data layer's global handler.
        }
    }

    const vitalDeleteLabel = (vital: 'BIRT' | 'DEAT'): string => {
        const date = vital === 'BIRT' ? person.BirthDate : person.DeathDate;
        return [tTypes(vital), date && formatDateForDisplay(date, language, dateWords)].filter(Boolean).join(' · ');
    };

    return (
        <div className="card card-pad" ref={panelRef} tabIndex={-1}>
            <Timeline items={timelineItems} />
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
            {confirmDeleteVital && (
                <ConfirmDialog
                    open
                    variant="calm"
                    tone="danger"
                    title={te('event_delete_confirm_title')}
                    body={
                        <>
                            <span className="font-semibold" style={{ color: 'var(--text)' }}>{vitalDeleteLabel(confirmDeleteVital)}</span>
                            <div className="mt-2 text-meta" style={{ color: 'var(--text-muted)' }}>{te('event_delete_audit_note')}</div>
                        </>
                    }
                    confirmLabel={tc('delete')}
                    onConfirm={handleDeleteVital}
                    onCancel={() => setConfirmDeleteVital(null)}
                />
            )}
        </div>
    );
}
