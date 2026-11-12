'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { EVENT_TYPES, getEventDisplayType } from '@/lib/db/schema';
import { formatDateForDisplay, sortableYear } from '@/lib/date-utils';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { getDataClient } from '@/lib/data';
import { isRecordGone } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import { DetailSkeleton, Skeleton } from '@/app/components/SkeletonLoader';
import RecordNotFound from '@/app/components/RecordNotFound';
import CitationDrawer from '@/app/components/CitationDrawer';
import { personResearchSubject } from '@/lib/research/subject';
import CitationPreview from '@/app/components/citations/CitationPreview';
import { CiteSheets, type CiteSheetTarget, type CiteSheetsSlot } from '@/app/components/citations/CiteSheets';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { citationFactFor, datedFactValue, describeCitationFact, numberSources, withFallbackCitationFacts } from '@/app/components/citations/factDescriptors';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import InlineEventEditor from '@/app/components/InlineEventEditor';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { useLanguage } from '@/app/components/LanguageProvider';
import LocationJourneyModal, { type JourneyStop } from '@/app/components/LocationJourneyModal';
import AddMediaModal from '@/app/components/media/AddMediaModal';
import { NamesPanel } from '@/app/components/person-form/NamesPanel';
import { ActionLink, AddRow, DetailBody, PageShell, InlineDataError, SectionHeader, StatusMark } from '@/app/components/ui';
import { canAddVitalEvent, compareTimelineItems, countDescendants, countSourcedFacts, countTotalFacts, fullName, hasDeathFact } from './derive';
import { livingStatus } from '@/lib/living';
import { usePersonDetail } from './usePersonDetail';
import { PersonSummaryView } from './PersonSummaryView';
import { LifeEventsPanel } from './LifeEventsPanel';
import { OwnerNotesCard, biographyNote, visibleNotes } from '@/app/components/notes/OwnerNotesCard';
import type { NameVariantDates, Note } from '@/lib/data/types';
import type { PersonGalleryMedia } from '@/lib/db/schema';
import MediaLightbox from '@/app/components/lightbox/MediaLightbox';
import { useChange } from './mobile/useChange';
import { timelineFacts as ownTimelineFacts } from './mobile/model';
import { PersonCover } from './desktop/PersonCover';
import { FamilyRail } from './desktop/FamilyRail';
import { EditPersonDialog } from './desktop/EditPersonDialog';
import { SourcesSection } from './desktop/SourcesSection';
import { PersonGalleryCard } from './PersonGalleryCard';
import { DescendantsPanel } from './DescendantsPanel';
import { useReturnFocus } from '@/app/hooks/useReturnFocus';
import { useDataCheckMarks } from '@/app/components/data-checks/marks';
import { MobilePersonPage, MobilePersonSkeleton } from './mobile/MobilePersonPage';
import { factPlaceEntry } from '@/lib/places/place-key';

export default function PersonDetailsClient() {
    const router = useRouter();
    const t = useTranslations('personDetail');
    const te = useTranslations('editPerson');
    const tc = useTranslations('common');
    const tTypes = useTranslations('eventTypes');
    const tNotes = useTranslations('notes');
    const tDesk = useTranslations('personDesktop');
    const { language } = useLanguage();
    const dateWords = useDateQualifierWords();
    const d = usePersonDetail();
    const {
        id, activeTreeId, activePermission, person, summary, media, citationMap, variants,
        personError, mediaError, citationsError, variantsError, citationsReady,
        mediaLoading, variantsLoading,
        placeCoords, phase, showDescendants, setShowDescendants, attachTarget, setAttachTarget,
        citationPreview, setCitationPreview,
        showInlineEvent, setShowInlineEvent, showUpload, setShowUpload, showJourney, setShowJourney,
        fetchPerson, fetchMedia, fetchCitations, refreshVariants, renderCitePin,
    } = d;
    const { reportError } = useErrorToast();
    // This person's dates to check (#833), re-checked whenever the person reloads.
    const personId = Number(id);
    const marks = useDataCheckMarks({ personId: Number.isInteger(personId) && personId > 0 ? personId : undefined }, person);
    // "+ Add event" unmounts while its panel is open; closing hands focus back (#690).
    const addEventRef = useReturnFocus(showInlineEvent);
    // Mirrored from OwnerNotesCard so the hero quote can render the preferred note
    // without a second fetch of the same rows (ADR 0010/0012). The hero writes
    // through its own client calls, so it bumps notesRefresh to pull the list back
    // in sync rather than the two surfaces each holding their own copy.
    const [notes, setNotes] = useState<Note[]>([]);
    const [notesRefresh, setNotesRefresh] = useState(0);
    // The rail reports the person's WHOLE list, fact-scoped rows included, because the
    // timeline needs those to count its Birth/Death notes. Everything the rail itself
    // shows — its heading count, and the hero quote below — reads this narrowed view
    // instead, so a birth note never turns up in either.
    const railNotes = visibleNotes(notes, 'unscoped');
    // Preferred note, else the oldest imported or legacy one (`biographyNote`, #902).
    // The fallback matters for every person who predates the preferred concept: a
    // strict read would show an empty biography to people who plainly have one.
    // Editing a fallback note promotes it (see PersonCover's Biography), so the slot converges
    // on an explicit choice. Narrowed first: an imported birth note carrying
    // IsPrimary = 1 would otherwise be quoted as the person's biography.
    const primaryNote = biographyNote(railNotes);
    const canEdit = activePermission !== 'view';
    // Writes need !== 'view'; deletes additionally exclude 'contribute' — the
    // server rejects those (lib/services/people.ts). Showing a button that
    // always 403s is the bug this closes (follow-up item 10).
    const canDelete = activePermission === 'owner' || activePermission === 'edit';
    // The phone page cites through sheets (#1049); the desktop page keeps the sidebar.
    const phoneCites = useIsMobile();
    // Desktop writes report the mobile way: reload, then the Undo toast (editors only).
    const run = useChange({
        treeId: activeTreeId,
        canUndo: canDelete,
        onChanged: async () => {
            setNotesRefresh((n) => n + 1);
            await Promise.all([fetchPerson(), fetchCitations(), refreshVariants(), fetchMedia()]);
        },
    });

    // Names & aliases (Task 7) — mutations call the data client directly (mirrors
    // usePersonForm's addNameVariant/removeNameVariant/updateNameVariant/
    // setPrimaryVariant), then refresh the variants list. `variantsBusy` disables
    // NamesPanel's controls for the duration of any single mutation.
    const [variantsBusy, setVariantsBusy] = useState(false);

    const handleAddVariant = useCallback(async (type: string, name: string, dates: NameVariantDates) => {
        if (!person) return;
        setVariantsBusy(true);
        try {
            const client = await getDataClient();
            await client.people.createNameVariant(person.Id, { Type: type, Name: name, ...dates }, activeTreeId);
            await refreshVariants();
        } catch (e) {
            // The person was deleted out from under this page (a GEDCOM overwrite
            // import re-creates everyone with fresh ids). Reload so the existing
            // not-found state renders instead of the write failing silently. This
            // branch stays AHEAD of reportError so the reload wins over a toast.
            if (isRecordGone(e)) { window.location.reload(); return; }
            reportError(e);
        } finally {
            setVariantsBusy(false);
        }
    }, [person, activeTreeId, refreshVariants, reportError]);

    const handleRenameVariant = useCallback(async (variantId: number, name: string, dates: NameVariantDates) => {
        if (!person) return;
        setVariantsBusy(true);
        try {
            const client = await getDataClient();
            await client.people.updateNameVariant(person.Id, variantId, name, activeTreeId, dates);
            await refreshVariants();
        } catch (e) {
            // The person was deleted out from under this page (a GEDCOM overwrite
            // import re-creates everyone with fresh ids). Reload so the existing
            // not-found state renders instead of the write failing silently. This
            // branch stays AHEAD of reportError so the reload wins over a toast.
            if (isRecordGone(e)) { window.location.reload(); return; }
            reportError(e);
        } finally {
            setVariantsBusy(false);
        }
    }, [person, activeTreeId, refreshVariants, reportError]);

    const handleRemoveVariant = useCallback(async (variantId: number) => {
        if (!person) return;
        setVariantsBusy(true);
        try {
            const client = await getDataClient();
            await client.people.removeNameVariant(person.Id, variantId, activeTreeId);
            await refreshVariants();
        } catch (e) {
            // The person was deleted out from under this page (a GEDCOM overwrite
            // import re-creates everyone with fresh ids). Reload so the existing
            // not-found state renders instead of the write failing silently. This
            // branch stays AHEAD of reportError so the reload wins over a toast.
            if (isRecordGone(e)) { window.location.reload(); return; }
            reportError(e);
        } finally {
            setVariantsBusy(false);
        }
    }, [person, activeTreeId, refreshVariants, reportError]);

    const handleSetPrimaryVariant = useCallback(async (variantId: number | null) => {
        if (!person) return;
        setVariantsBusy(true);
        try {
            const client = await getDataClient();
            if (variantId == null) {
                const current = variants.find((v) => v.IsPrimary);
                if (current) await client.people.setPrimaryNameVariant(person.Id, current.Id, false, activeTreeId);
            } else {
                await client.people.setPrimaryNameVariant(person.Id, variantId, true, activeTreeId);
            }
            await refreshVariants();
        } catch (e) {
            // The person was deleted out from under this page (a GEDCOM overwrite
            // import re-creates everyone with fresh ids). Reload so the existing
            // not-found state renders instead of the write failing silently. This
            // branch stays AHEAD of reportError so the reload wins over a toast.
            if (isRecordGone(e)) { window.location.reload(); return; }
            reportError(e);
        } finally {
            setVariantsBusy(false);
        }
    }, [person, activeTreeId, variants, refreshVariants, reportError]);

    // Edit person (#49) and the delete confirm. Birth and death are edited on the timeline.
    const [editOpen, setEditOpen] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);
    // The portrait opens in the lightbox, where it can be changed (#49).
    const [viewing, setViewing] = useState<PersonGalleryMedia | null>(null);
    const lifeEventsRef = useRef<HTMLElement>(null);

    const handleDeletePerson = useCallback(async () => {
        if (!person) return;
        setDeleting(true);
        try {
            const client = await getDataClient();
            await client.people.remove(person.Id, activeTreeId);
            router.push('/people');
        } catch (e) {
            // Reset the dialog + spinner on ANY error (handled or not) so the
            // confirm can never get stuck spinning; then surface the failure.
            setDeleting(false);
            setShowDeleteConfirm(false);
            reportError(e);
        }
    }, [person, activeTreeId, router, reportError]);

    if (!person) {
        // Full record not ready yet. While loading, prefer an instant hero painted
        // from the cached identity summary (#2); else the skeleton (slow cold load)
        // or the brief pending surface. A finished load with no record ⇒ not found.
        const stillLoading = phase === 'loading' || phase === 'pending';
        if (personError) {
            return (
                <PageShell variant="detail">
                    <InlineDataError message={personError} retryLabel={tc('retry')} onRetry={fetchPerson} />
                </PageShell>
            );
        }
        // Phones paint the phone page's own shapes while loading, never the desktop hero.
        if (summary && stillLoading) {
            return (
                <>
                    <div className="contents max-md:hidden"><PersonSummaryView summary={summary} treeId={activeTreeId} /></div>
                    <div className="contents md:hidden"><MobilePersonSkeleton /></div>
                </>
            );
        }
        if (phase === 'loading') {
            return (
                <>
                    <div className="contents max-md:hidden"><DetailSkeleton /></div>
                    <div className="contents md:hidden"><MobilePersonSkeleton /></div>
                </>
            );
        }
        if (phase === 'pending') return <PageShell variant="detail" busy />;
        return <RecordNotFound record="person" />;
    }

    // Ordered, geocoded stops for the journey modal: Birth, events, Death — in
    // chronological order, only those with resolved coordinates.
    const journeyStops: JourneyStop[] = (() => {
        const raw: { year: number | null; place: string; placeId: number | null; title: string; date: string | null }[] = [];
        if (person.BirthPlace) raw.push({ year: sortableYear(person.BirthDate), place: person.BirthPlace, placeId: person.BirthPlaceId ?? null, title: t('fact_birth'), date: person.BirthDate });
        for (const ev of person.events ?? []) {
            if (ev.Place) raw.push({ year: sortableYear(ev.Date), place: ev.Place, placeId: ev.PlaceId ?? null, title: getEventDisplayType(ev.Type), date: ev.Date });
        }
        if (person.DeathPlace) raw.push({ year: sortableYear(person.DeathDate), place: person.DeathPlace, placeId: person.DeathPlaceId ?? null, title: t('fact_death'), date: person.DeathDate });
        raw.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
        return raw
            .map(r => {
                const c = factPlaceEntry(placeCoords, r.place, r.placeId);
                return c ? { lat: c.lat, lng: c.lng, label: r.place, title: r.title, date: r.date ? formatDateForDisplay(r.date, language, dateWords) : null } : null;
            })
            .filter((s): s is JourneyStop => s !== null);
    })();

    const factValue = (date: string | null | undefined, place: string | null | undefined) =>
        datedFactValue(date ? formatDateForDisplay(date, language, dateWords) : null, place, tc('unknown'));
    const variantLabel = (type: string) => {
        switch (type) {
            case 'Given': return t('vtype_given');
            case 'Nickname': return t('vtype_nickname');
            case 'Maiden': return t('vtype_maiden');
            case 'Married': return t('vtype_married');
            case 'Anglicized': return t('vtype_anglicized');
            case 'Alias': return t('vtype_alias');
            default: return type;
        }
    };
    // Page order (#754): the timeline as LifeEventsPanel sorts it, then the
    // Names panel, then whole-person citations, which only the rail shows.
    const timelineFacts = [
        { type: 'BIRT', sortKey: sortableYear(person.BirthDate), fact: describeCitationFact(citationMap, FACT_TABLES.PERSON_BIRTH, person.Id, t('fact_birth'), factValue(person.BirthDate, person.BirthPlace)) },
        ...(person.events ?? []).map(event => ({ type: event.Type, sortKey: sortableYear(event.Date), fact: describeCitationFact(
            citationMap,
            FACT_TABLES.EVENTS,
            event.Id,
            EVENT_TYPES[event.Type] ? tTypes(event.Type as Parameters<typeof tTypes>[0]) : getEventDisplayType(event.Type),
            factValue(event.Date, event.Place),
        ) })),
        { type: 'DEAT', sortKey: sortableYear(person.DeathDate), fact: describeCitationFact(citationMap, FACT_TABLES.PERSON_DEATH, person.Id, t('fact_death'), factValue(person.DeathDate, person.DeathPlace)) },
    ].sort(compareTimelineItems).map(item => item.fact);
    const personCitationFacts = withFallbackCitationFacts([
        ...timelineFacts,
        describeCitationFact(citationMap, FACT_TABLES.PERSON_NAME, person.Id, t('col_name'), fullName(person, tc('unknown'))),
        ...variants.map(variant => describeCitationFact(citationMap, FACT_TABLES.NAME_VARIANT, variant.Id, variantLabel(variant.Type), variant.Name)),
        describeCitationFact(citationMap, FACT_TABLES.PEOPLE, person.Id, t('this_person'), fullName(person, tc('unknown'))),
    ], citationMap, (table, factId) => tc('citation_fact_fallback', { table, id: factId }));
    const sourceNumbers = numberSources(personCitationFacts);
    const attachFact = attachTarget ? citationFactFor(personCitationFacts, attachTarget) : null;
    const research = attachFact ? personResearchSubject(person, variants, attachFact.factTable, attachFact.factId, new Date().getFullYear()) : null;
    const renderNumberedCitePin = (factTable: string, factId: number, factLabel: string) =>
        renderCitePin(factTable, factId, factLabel, sourceNumbers);
    const previewTarget = citationPreview ? {
        ...citationPreview,
        fact: personCitationFacts.find(f => f.factTable === citationPreview.fact.factTable && f.factId === citationPreview.fact.factId) ?? citationPreview.fact,
    } : null;

    const phoneCiteTarget: CiteSheetTarget | null = previewTarget
        ? { fact: previewTarget.fact, start: 'view', citationId: previewTarget.citation.Id }
        : attachTarget && attachFact && (canEdit || (attachTarget.initialView === 'search' && research))
            ? {
                fact: attachFact,
                start: attachTarget.initialCitationId ? 'edit' : attachTarget.initialView === 'search' ? 'search' : 'pick',
                citationId: attachTarget.initialCitationId,
            }
            : null;
    // A pin's sheet can lead to Search online records too, so the subject follows whichever fact is open.
    const phoneResearch = phoneCiteTarget && phoneCiteTarget.fact !== attachFact
        ? personResearchSubject(person, variants, phoneCiteTarget.fact.factTable, phoneCiteTarget.fact.factId, new Date().getFullYear())
        : research;

    // A sheet that cites from inside itself (the event sheet) renders its own copy, so it nests.
    const citeSheets: CiteSheetsSlot = (target, onClose) => (
        <CiteSheets
            target={target}
            subject={fullName(person)}
            sourceNumbers={sourceNumbers}
            canCite={canEdit}
            canDelete={canDelete}
            research={target ? personResearchSubject(person, variants, target.fact.factTable, target.fact.factId, new Date().getFullYear()) : null}
            onClose={onClose}
            onChanged={fetchCitations}
        />
    );

    const role = activePermission === 'view' ? 'viewer' : canDelete ? 'editor' : 'contributor';
    const citePins = (fact: { factTable: string; factId: number }, label: string) => {
        // Viewers get no "No source" prompts on phones; chips still open the source.
        if (role === 'viewer' && !(citationMap[`${fact.factTable}:${fact.factId}`]?.length)) return null;
        return renderNumberedCitePin(fact.factTable, fact.factId, label);
    };
    const phonePage = (
        <MobilePersonPage
            person={person}
            media={media}
            variants={variants}
            notes={notes}
            biography={primaryNote}
            facts={personCitationFacts}
            sourceNumbers={sourceNumbers}
            marks={marks}
            treeId={activeTreeId}
            role={role}
            language={language}
            placeCoords={placeCoords}
            descendants={countDescendants(person)}
            citePins={citePins}
            citeSheets={citeSheets}
            onShowDescendants={() => setShowDescendants(true)}
            onCite={(fact, label) => setAttachTarget({ factTable: fact.factTable, factId: fact.factId, factLabel: label, initialView: 'add' })}
            onAddMedia={() => setShowUpload(true)}
            onMediaChanged={fetchMedia}
            onChanged={async () => {
                // Names, notes and the portrait live outside the person row, so a phone edit reloads them too.
                setNotesRefresh((n) => n + 1);
                await Promise.all([fetchPerson(), fetchCitations(), refreshVariants(), fetchMedia()]);
            }}
        />
    );

    const lifeEventsCount = ownTimelineFacts(person).length;
    const toVital = (which: 'birth' | 'death') => {
        setEditOpen(false);
        // After the dialog has closed and handed focus back, go to the row.
        window.setTimeout(() => {
            const section = lifeEventsRef.current;
            const row = section?.querySelector<HTMLElement>(`#${which}`) ?? section;
            row?.scrollIntoView({ block: 'center' });
            row?.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true });
        }, 0);
    };

    return (
        <>
            <PageShell variant="detail" topBar={phonePage} contentClassName="max-md:hidden">

                {personError && (
                    <InlineDataError
                        message={personError}
                        retryLabel={tc('retry')}
                        onRetry={fetchPerson}
                        className="mb-5"
                    />
                )}

                <PersonCover
                    person={person}
                    media={media}
                    treeId={activeTreeId}
                    role={role}
                    datesToCheck={marks.open.length}
                    biography={primaryNote}
                    run={run}
                    onEdit={() => setEditOpen(true)}
                    hasDescendants={countDescendants(person) > 0}
                    onDescendants={() => setShowDescendants(true)}
                    onDelete={() => setShowDeleteConfirm(true)}
                    onAddPortrait={() => setShowUpload(true)}
                    onOpenPortrait={setViewing}
                />

                <DetailBody
                    index={[
                        { id: 'life-events', label: t('life_events') },
                        { id: 'media', label: tDesk('media') },
                        { id: 'names', label: tDesk('names') },
                        { id: 'notes', label: tNotes('section_title') },
                        { id: 'sources', label: tDesk('sources') },
                    ]}
                    rail={(
                        <FamilyRail
                            person={person}
                            portrait={media.find((m) => m.IsPersonPrimary)}
                            treeId={activeTreeId}
                            canEdit={canEdit}
                            canDelete={canDelete}
                            journeyCount={journeyStops.length}
                            onShowJourney={() => setShowJourney(true)}
                            onChanged={fetchPerson}
                        />
                    )}
                >
                    <section ref={lifeEventsRef} id="life-events" aria-labelledby="life-events-title">
                        <SectionHeader
                            headingId="life-events-title"
                            title={t('life_events')}
                            count={lifeEventsCount}
                            // Relatives' rows aren't counted here or in "N of N sourced" (#49).
                            action={lifeEventsCount > 0 && (
                                <span className="text-meta text-text-muted tabular-nums">
                                    {tDesk('sourced_of', { sourced: countSourcedFacts(person, citationMap), total: countTotalFacts(person) })}
                                </span>
                            )}
                        />
                        {/* With no death recorded, the status needs a home every role can see (#49). */}
                        {!hasDeathFact(person) && (
                            <p className="m-0 mb-3 inline-flex items-center gap-1.5 text-sm text-text-secondary">
                                <StatusMark status={livingStatus(person)} />
                                {livingStatus(person) === 'living' ? tDesk('status_living') : tDesk('status_unknown')}
                            </p>
                        )}
                        <LifeEventsPanel
                            person={person}
                            marks={marks}
                            run={run}
                            language={language}
                            renderCitePin={renderNumberedCitePin}
                            tTypes={tTypes}
                            placeCoords={placeCoords}
                            canEdit={canEdit}
                            canDelete={canDelete}
                            onChanged={() => { fetchPerson(); fetchCitations(); }}
                            personNotes={notes}
                            personMedia={media}
                            onMediaChanged={fetchMedia}
                            footer={canEdit && (showInlineEvent ? (
                                <div className="p-3">
                                    <InlineEventEditor
                                        target={{ kind: 'person', personId: parseInt(id, 10) }}
                                        allowVital={{
                                            birth: canAddVitalEvent(person, 'BIRT'),
                                            death: canAddVitalEvent(person, 'DEAT'),
                                        }}
                                        onCancel={() => setShowInlineEvent(false)}
                                        onRefresh={() => {
                                            fetchPerson();
                                            fetchCitations();
                                        }}
                                        onSaved={() => {
                                            setShowInlineEvent(false);
                                            fetchPerson();
                                            fetchCitations();
                                        }}
                                    />
                                </div>
                            ) : (
                                <AddRow ref={addEventRef} label={t('add_event')} onClick={() => setShowInlineEvent(true)} className="rounded-b-card" />
                            ))}
                        />
                    </section>

                    <section id="media" aria-labelledby="media-title">
                        <SectionHeader
                            headingId="media-title"
                            title={tDesk('media')}
                            count={media.length}
                            action={canEdit && <ActionLink onClick={() => setShowUpload(true)}>{tDesk('add_media')}</ActionLink>}
                        />
                        {mediaError && (
                            <InlineDataError message={mediaError} retryLabel={tc('retry')} onRetry={fetchMedia} className="mb-3" />
                        )}
                        {mediaError && media.length === 0 ? null : mediaLoading && media.length === 0 ? (
                            <div className="card card-pad" aria-busy="true"><Skeleton className="h-28 w-full" /></div>
                        ) : (
                            <PersonGalleryCard
                                media={media}
                                personId={Number(id)}
                                treeId={activeTreeId}
                                canEdit={canEdit}
                                canDelete={canDelete}
                                onPrimaryChanged={fetchMedia}
                                onAddPhoto={() => setShowUpload(true)}
                            />
                        )}
                    </section>

                    <section id="names" aria-labelledby="names-title">
                        <SectionHeader headingId="names-title" title={tDesk('names')} />
                        {variantsError && (
                            <InlineDataError message={variantsError} retryLabel={tc('retry')} onRetry={refreshVariants} className="mb-3" />
                        )}
                        {variantsError && variants.length === 0 ? null : variantsLoading && variants.length === 0 ? (
                            <div className="card card-pad" aria-busy="true"><Skeleton className="h-20 w-full" /></div>
                        ) : (
                            <NamesPanel
                                person={person}
                                variants={variants}
                                renderCitePin={renderNumberedCitePin}
                                canEdit={canEdit}
                                canDelete={canDelete}
                                onAdd={handleAddVariant}
                                onRename={handleRenameVariant}
                                onRemove={handleRemoveVariant}
                                onSetPrimary={handleSetPrimaryVariant}
                                busy={variantsBusy}
                            />
                        )}
                    </section>

                    {/* Notes: first-class Note + NoteLink rows (ADR 0010 / #407). It owns
                        the fetch for the whole page: the biography and the timeline's
                        Birth/Death counts both read its report. It lists the unscoped
                        notes; a note about the birth is read on the birth row. */}
                    <section id="notes" aria-labelledby="notes-title">
                        <OwnerNotesCard
                            ownerTable="People"
                            ownerId={parseInt(id, 10)}
                            treeId={activeTreeId}
                            canEdit={canEdit}
                            canDelete={canDelete}
                            factScope="unscoped"
                            onNotesChange={setNotes}
                            refreshKey={notesRefresh}
                            // The band shows the biography; this lists the rest (ED-3),
                            // and its "preferred" action reads "Use as the biography" (#902).
                            shownElsewhereId={primaryNote?.Id ?? null}
                            preferredIsBiography
                            header={<SectionHeader headingId="notes-title" title={tNotes('section_title')} className="mb-0" />}
                        />
                    </section>

                    <section id="sources" aria-labelledby="sources-title">
                        {citationsError && (
                            <InlineDataError message={citationsError} retryLabel={tc('retry')} onRetry={fetchCitations} className="mb-3" />
                        )}
                        <SourcesSection facts={personCitationFacts} title={t('sources_cited')} />
                    </section>
                </DetailBody>
            </PageShell>

            {/* Outside the content column, which phones hide behind their own page. */}
            {showUpload && (
                <AddMediaModal
                    target={{ kind: 'owner', ownerTable: 'People', ownerId: Number(id) }}
                    treeId={activeTreeId}
                    targetName={fullName(person)}
                    relevantPersonIds={[Number(id)]}
                    onClose={() => setShowUpload(false)}
                    onMediaChanged={fetchMedia}
                    onAdded={() => setShowUpload(false)}
                />
            )}

            <EditPersonDialog
                open={editOpen}
                onClose={() => setEditOpen(false)}
                person={person}
                treeId={activeTreeId}
                language={language}
                run={run}
                onEditVital={toVital}
            />

            {viewing && (
                <MediaLightbox
                    items={[viewing]}
                    index={0}
                    treeId={activeTreeId}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    context="person"
                    galleryPersonId={person.Id}
                    galleryPersonName={person}
                    onClose={() => setViewing(null)}
                    onChangeIndex={() => {}}
                    onPrimaryChanged={fetchMedia}
                    onTagsChanged={fetchMedia}
                    onDeleted={() => { setViewing(null); fetchMedia(); }}
                />
            )}

            {/* Descendants slide-in panel */}
            {showDescendants && (
                <DescendantsPanel
                    person={person}
                    treeId={activeTreeId}
                    onClose={() => setShowDescendants(false)}
                />
            )}

            {/* Not gated on citationsReady: every opener already is, and a refetch after a
                save would unmount the drawer, losing the search a cite returns to (#1029). */}
            {phoneCites && (
                <CiteSheets
                    target={phoneCiteTarget}
                    subject={fullName(person)}
                    sourceNumbers={sourceNumbers}
                    canCite={canEdit}
                    canDelete={canDelete}
                    research={phoneResearch}
                    onClose={() => { setAttachTarget(null); setCitationPreview(null); }}
                    onChanged={fetchCitations}
                />
            )}

            {!phoneCites && attachTarget && (canEdit || (attachTarget.initialView === 'search' && research)) && attachFact && (
                <CitationDrawer
                    title={fullName(person)}
                    fact={attachFact}
                    canDetach={canDelete}
                    canCite={canEdit}
                    research={research}
                    initialCitationId={attachTarget.initialCitationId}
                    initialView={attachTarget.initialView}
                    onClose={() => setAttachTarget(null)}
                    onChanged={fetchCitations}
                />
            )}

            {!phoneCites && previewTarget && (
                <CitationPreview
                    target={previewTarget}
                    sourceNumbers={sourceNumbers}
                    canEdit={canEdit && citationsReady}
                    onClose={() => setCitationPreview(null)}
                    onEdit={(citation) => {
                        if (!citationsReady) return;
                        setCitationPreview(null);
                        setAttachTarget({
                            factTable: previewTarget.fact.factTable,
                            factId: previewTarget.fact.factId,
                            factLabel: previewTarget.fact.label,
                            initialCitationId: citation.Id,
                            initialView: 'editor',
                        });
                    }}
                />
            )}

            {showJourney && journeyStops.length > 0 && (
                <LocationJourneyModal stops={journeyStops} onClose={() => setShowJourney(false)} />
            )}

            <ConfirmDialog
                open={showDeleteConfirm}
                variant="calm"
                tone="danger"
                title={te('delete_person')}
                body={te('delete_confirm', { name: fullName(person) })}
                confirmLabel={tc('yes_delete')}
                busy={deleting}
                onConfirm={handleDeletePerson}
                onCancel={() => setShowDeleteConfirm(false)}
            />
        </>
    );
}
