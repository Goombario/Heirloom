'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { formatDateForDisplay, sortableYear } from '@/lib/date-utils';
import { OwnerNotesCard, biographyNote, visibleNotes } from '@/app/components/notes/OwnerNotesCard';
import type { Note } from '@/lib/data/types';
import { useChange } from '@/app/people/view/mobile/useChange';
import { SourcesSection } from '@/app/people/view/desktop/SourcesSection';
import { FamilyCover } from './desktop/FamilyCover';
import { FamilyRail } from './desktop/FamilyRail';
import { OwnerMediaCard } from '@/app/components/media/OwnerMediaCard';
import { DetailSkeleton } from '@/app/components/SkeletonLoader';
import RecordNotFound from '@/app/components/RecordNotFound';
import CitationDrawer from '@/app/components/CitationDrawer';
import { familyResearchSubject } from '@/lib/research/subject';
import CitationPreview from '@/app/components/citations/CitationPreview';
import { CiteSheets, type CiteSheetTarget, type CiteSheetsSlot } from '@/app/components/citations/CiteSheets';
import Cite from '@/app/components/Cite';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { chipCitations, citationFactFor, datedFactValue, describeCitationFact, numberSources, withFallbackCitationFacts } from '@/app/components/citations/factDescriptors';
import InlineEventEditor from '@/app/components/InlineEventEditor';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { AddRow, DetailBody, PageShell, InlineDataError, SectionHeader } from '@/app/components/ui';
import { cx } from '@/app/components/ui/cx';
import { FACT_TABLES, isFactTableValue, type FactTableValue } from '@/lib/db/fact-tables';
import { getDataClient } from '@/lib/data';
import { useErrorToast } from '@/app/components/useErrorToast';
import { usePlaceResolutionFlush } from '@/app/components/usePlaceResolutionFlush';
import type { FamilyType } from '@/lib/db/schema';
import { familyEventLabel } from '@/app/components/familyEventTypes';
import { useFamilyDetail } from './useFamilyDetail';
import { FamilySummaryView } from './FamilySummaryView';
import { FamilyHeroEditor, type FamilyHeroPatch } from './FamilyHeroEditor';
import { hasRecordedDeath, partnerName, sortChildrenByBirth, partnershipKindKey, partnershipYears, earlierDeathPartner, endFromEvents, endEventOf, endReasonOf, END_REASON_TAGS } from './derive';
import { FamilyTimeline } from './sections';
import { useReturnFocus } from '@/app/hooks/useReturnFocus';
import { useDataCheckMarks } from '@/app/components/data-checks/marks';
import { MobilePersonSkeleton } from '@/app/people/view/mobile/MobilePersonPage';
import { MobileFamilyPage } from './mobile/MobileFamilyPage';
import type { OtherPartnerships as PhoneOtherPartnerships } from './mobile/panes';

export default function FamilyDetailsClient() {
    const router = useRouter();
    const t = useTranslations('families');
    const tCommon = useTranslations('common');
    const tEvent = useTranslations('eventEdit');
    const { language } = useLanguage();
    const dateWords = useDateQualifierWords();
    const {
        familyId, details, summary, error, notFound, phase,
        partner1Families, partner2Families, partner1Error, partner2Error,
        retryPartner1, retryPartner2, citationMap, citationError, citationsReady, retryCitations,
        showInlineEvent, setShowInlineEvent, attachTarget, setAttachTarget,
        citationPreview, setCitationPreview,
        placeCoords, isOpen, toggle, fetchFamily, activeTreeId, activePermission,
    } = useFamilyDetail();
    const { reportError } = useErrorToast();
    const flushPlace = usePlaceResolutionFlush(activeTreeId);
    // "+ Add event" unmounts while its panel is open; closing hands focus back (#690).
    const addEventRef = useReturnFocus(showInlineEvent);

    const [editingHero, setEditingHero] = useState(false);
    const [savingHero, setSavingHero] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [noteCount, setNoteCount] = useState(0);
    const [familyNotes, setFamilyNotes] = useState<Note[]>([]);
    const [mediaCount, setMediaCount] = useState<number | null>(null);
    // About this family writes notes through its own calls: the Notes list refetches after.
    const [notesRefresh, setNotesRefresh] = useState(0);
    const tChecks = useTranslations('dataChecks');
    const run = useChange({
        treeId: activeTreeId,
        canUndo: activePermission === 'owner' || activePermission === 'edit',
        onChanged: () => { setNotesRefresh((n) => n + 1); return fetchFamily(); },
    });
    // The family's dates to check (#833): the hero flag and the timeline marks.
    const familyNum = Number(familyId);
    const marks = useDataCheckMarks({ familyId: Number.isInteger(familyNum) && familyNum > 0 ? familyNum : undefined }, details);
    // Phones cite through sheets, not the drawer and popover (#1062).
    const phoneCites = useIsMobile();

    const handleSaveHero = useCallback(async ({ placeResolution, end, ...familyPatch }: FamilyHeroPatch) => {
        setSavingHero(true);
        try {
            const client = await getDataClient();
            const id = Number(familyId);
            const saved = await client.families.update(id, familyPatch, activeTreeId);
            const endEvent = endEventOf(details?.events);
            if (end && endEvent) {
                // Retype only when the reason changed, so a DIVF (divorce filed) stays one.
                const patch: { Type?: string; Date?: string | null } = {};
                if (endReasonOf(endEvent.Type) !== end.reason) patch.Type = END_REASON_TAGS[end.reason];
                if ((endEvent.Date ?? null) !== end.date) patch.Date = end.date;
                if (patch.Type !== undefined || patch.Date !== undefined) await client.events.update(endEvent.Id, patch, activeTreeId);
            } else if (end) {
                await client.events.create({ Type: END_REASON_TAGS[end.reason], Date: end.date, FamilyId: id }, activeTreeId);
            }
            await flushPlace(familyPatch.MarriagePlace ?? '', placeResolution, saved.MarriagePlaceId);
            await fetchFamily();
            setEditingHero(false);
        } catch (e) {
            reportError(e);
        } finally {
            setSavingHero(false);
        }
    }, [familyId, activeTreeId, details?.events, fetchFamily, flushPlace, reportError]);

    const handleDeleteFamily = useCallback(async () => {
        setDeleting(true);
        try {
            const client = await getDataClient();
            await client.families.remove(Number(familyId), activeTreeId);
            router.push('/families');
        } catch (e) {
            setDeleting(false);
            setShowDeleteConfirm(false);
            reportError(e);
        }
    }, [familyId, activeTreeId, router, reportError]);

    if (!details) {
        // Full record not ready yet. While loading, prefer an instant hero painted
        // from the cached partnership summary; else the skeleton (slow cold load) or
        // the brief pending surface. A finished load with no record ⇒ not found below.
        const stillLoading = phase === 'loading' || phase === 'pending';
        // Phones paint the phone page's own shapes while loading, never the desktop hero.
        if (summary && stillLoading && !error) {
            return (
                <>
                    <div className="contents max-md:hidden"><FamilySummaryView summary={summary} treeId={activeTreeId} /></div>
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
    }

    if (!details) {
        if (notFound || !error) return <RecordNotFound record="family" />;
        return (
            <PageShell variant="detail" className="flex flex-col" contentClassName="flex-1 flex items-center justify-center">
                <div className="w-full max-w-lg px-5 text-center">
                    <InlineDataError message={error} retryLabel={tCommon('retry')} onRetry={fetchFamily} className="mb-3 text-left" />
                    <Link href="/families" className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-link hover:bg-hover-surface rounded-lg transition-colors">{tCommon('back_to_families')}</Link>
                </div>
            </PageShell>
        );
    }

    const partner1 = details.husband;
    const partner2 = details.wife;
    const family = details.family;
    const children = sortChildrenByBirth(details.children);
    const canEdit = activePermission !== 'view';
    // Writes need !== 'view'; deletes additionally exclude 'contribute' — the
    // server rejects those (lib/services/families.ts). Showing a button that
    // always 403s is the bug this closes (follow-up item 10).
    const canDelete = activePermission === 'owner' || activePermission === 'edit';
    const relevantPersonIds = Array.from(new Set(
        [partner1?.Id, partner2?.Id, ...children.map((child) => child.Id)]
            .filter((id): id is number => id != null),
    ));

    const familyType = family.Type ?? null;
    // A divorce/annulment/separation ends the partnership even when both partners
    // outlive it, so the explicit end-event wins over the death derivation.
    const unionEnd = endFromEvents(details.events);
    const { began, ended } = partnershipYears(partner1, partner2, family.MarriageDate, unionEnd?.date);
    const earlierPartner = earlierDeathPartner(partner1, partner2);
    const ownerTitle = `${partnerName(partner1) || tCommon('unknown')} + ${partnerName(partner2) || tCommon('unknown')}`;
    const citationValue = (date: string | null | undefined, place: string | null | undefined) =>
        datedFactValue(date ? formatDateForDisplay(date, language, dateWords) : null, place, tCommon('unknown'));
    // Timeline order (#754), as FamilyTimeline builds and sorts its rows: dated
    // first, undated last. Children's recorded births and deaths carry pins too (#799).
    const childFirstName = (child: typeof children[number]) => (partnerName(child) || tCommon('unknown')).split(' ')[0];
    const timelineFacts = [
        { sortKey: sortableYear(family.MarriageDate), fact: describeCitationFact(citationMap, FACT_TABLES.FAMILIES, family.Id, t(partnershipKindKey(familyType)), citationValue(family.MarriageDate, family.MarriagePlace)) },
        { sortKey: sortableYear(family.MarriageDate), fact: describeCitationFact(citationMap, FACT_TABLES.FAMILY_MARRIAGE, family.Id, t(partnershipKindKey(familyType)), citationValue(family.MarriageDate, family.MarriagePlace)) },
        ...(details.events ?? []).map(event => ({ sortKey: sortableYear(event.Date), fact: describeCitationFact(
            citationMap, FACT_TABLES.EVENTS, event.Id, familyEventLabel(event.Type, tEvent), citationValue(event.Date, event.Place),
        ) })),
        ...children.filter(child => child.BirthDate || child.BirthPlace).map(child => ({ sortKey: sortableYear(child.BirthDate), fact: describeCitationFact(
            citationMap, FACT_TABLES.PERSON_BIRTH, child.Id, `${t('birth_label')} · ${childFirstName(child)}`, citationValue(child.BirthDate, child.BirthPlace),
        ) })),
        ...(details.childAdoptions ?? []).flatMap(event => {
            const child = children.find(c => c.Id === event.PersonId);
            return child ? [{ sortKey: sortableYear(event.Date), fact: describeCitationFact(
                citationMap, FACT_TABLES.EVENTS, event.Id, `${familyEventLabel('ADOP', tEvent)} · ${childFirstName(child)}`, citationValue(event.Date, event.Place),
            ) }] : [];
        }),
        ...children.filter(hasRecordedDeath).map(child => ({ sortKey: sortableYear(child.DeathDate), fact: describeCitationFact(
            citationMap, FACT_TABLES.PERSON_DEATH, child.Id, t('death_of', { name: childFirstName(child) }), citationValue(child.DeathDate, child.DeathPlace),
        ) })),
    ].sort((a, b) => (a.sortKey ?? Infinity) - (b.sortKey ?? Infinity)).map(item => item.fact);
    const familyCitationFacts = withFallbackCitationFacts(timelineFacts, citationMap, (table, factId) => tCommon('citation_fact_fallback', { table, id: factId }));
    const sourceNumbers = numberSources(familyCitationFacts);
    const attachFact = attachTarget ? citationFactFor(familyCitationFacts, attachTarget) : null;
    const research = attachFact ? familyResearchSubject(details, attachFact.factTable, attachFact.factId, new Date().getFullYear()) : null;
    const previewTarget = citationPreview ? {
        ...citationPreview,
        fact: familyCitationFacts.find(f => f.factTable === citationPreview.fact.factTable && f.factId === citationPreview.fact.factId) ?? citationPreview.fact,
    } : null;

    // The phone page (#1062): sheets instead of the drawer and the popover.
    const phoneCiteTarget: CiteSheetTarget | null = previewTarget
        ? { fact: previewTarget.fact, start: 'view', citationId: previewTarget.citation.Id }
        : attachTarget && attachFact && (canEdit || (attachTarget.initialView === 'search' && research))
            ? {
                fact: attachFact,
                start: attachTarget.initialCitationId ? 'edit' : attachTarget.initialView === 'search' ? 'search' : 'pick',
                citationId: attachTarget.initialCitationId,
            }
            : null;
    const phoneResearch = phoneCiteTarget && phoneCiteTarget.fact !== attachFact
        ? familyResearchSubject(details, phoneCiteTarget.fact.factTable, phoneCiteTarget.fact.factId, new Date().getFullYear())
        : research;
    // A sheet that cites from inside itself (the event sheet) renders its own copy, so it nests.
    const citeSheets: CiteSheetsSlot = (target, onClose) => (
        <CiteSheets
            target={target}
            subject={ownerTitle}
            sourceNumbers={sourceNumbers}
            canCite={canEdit}
            canDelete={canDelete}
            research={target ? familyResearchSubject(details, target.fact.factTable, target.fact.factId, new Date().getFullYear()) : null}
            onClose={onClose}
            onChanged={fetchFamily}
        />
    );
    const role = activePermission === 'view' ? 'viewer' : canDelete ? 'editor' : 'contributor';
    const aboutNote = biographyNote(visibleNotes(familyNotes, 'unscoped'));
    // A fact's chips. A marriage's imported MARR citations ride the family's own pin.
    const citePins = (fact: { factTable: string; factId: number }, label: string) => {
        if (fact.factTable === FACT_TABLES.FAMILY_MARRIAGE || !isFactTableValue(fact.factTable)) return null;
        const factTable = fact.factTable;
        const tables: FactTableValue[] = factTable === FACT_TABLES.FAMILIES ? [FACT_TABLES.FAMILIES, FACT_TABLES.FAMILY_MARRIAGE] : [fact.factTable];
        const cites = tables.flatMap((table) => (citationMap[`${table}:${fact.factId}`] ?? []).map((c) => ({ table, c })));
        // Viewers get no "No source" prompts on phones; chips still open the source.
        if (cites.length === 0) {
            if (role === 'viewer' || !citationsReady) return null;
            return <Cite empty factLabel={label} onClick={() => setAttachTarget({ factTable, factId: fact.factId, factLabel: label, initialView: 'add' })} />;
        }
        return (
            <>
                {tables.map((table) => {
                    const own = citationMap[`${table}:${fact.factId}`] ?? [];
                    return chipCitations(own, sourceNumbers).map((c) => (
                        <Cite key={`${table}:${c.Id}`} n={sourceNumbers.get(c.SourceId)} sourceTitle={c.sourceTitle ?? undefined}
                            onClick={(anchor) => setCitationPreview({ anchor, citation: c, fact: { factTable: table, factId: fact.factId, label, value: label, citations: own } })} />
                    ));
                })}
            </>
        );
    };
    const others: PhoneOtherPartnerships[] = [
        { slot: 'partner1' as const, partner: partner1, families: partner1Families },
        { slot: 'partner2' as const, partner: partner2, families: partner2Families },
    ].flatMap(({ slot, partner, families }) => (partner && families
        ? [{ slot, partner, spouses: families.spouses.filter((s) => s.family.Id !== family.Id) }]
        : []));
    const phonePage = (
        <MobileFamilyPage
            data={{ family, partner1: partner1 ?? null, partner2: partner2 ?? null, children, events: details.events ?? [], childAdoptions: details.childAdoptions ?? [] }}
            others={others}
            facts={familyCitationFacts}
            sourceNumbers={sourceNumbers}
            marks={marks}
            treeId={activeTreeId}
            role={role}
            language={language}
            active={phoneCites}
            citePins={citePins}
            citeSheets={citeSheets}
            onCite={(fact, label) => {
                if (isFactTableValue(fact.factTable)) setAttachTarget({ factTable: fact.factTable, factId: fact.factId, factLabel: label, initialView: 'add' });
            }}
            onChanged={fetchFamily}
        />
    );

    return (
        <>
            <PageShell variant="detail" topBar={phonePage} contentClassName="max-md:hidden">

                {error && (
                    <InlineDataError
                        message={error}
                        retryLabel={tCommon('retry')}
                        onRetry={fetchFamily}
                        className="mb-5"
                    />
                )}

                {/* The v1.1 board (#119, B without a family photo): the band with the
                    split partner portrait and About this family beside it. */}
                <FamilyCover
                    familyId={family.Id}
                    type={familyType}
                    partner1={partner1 ?? null}
                    partner2={partner2 ?? null}
                    began={began || null}
                    ended={ended || null}
                    place={family.MarriagePlace ?? null}
                    about={aboutNote}
                    treeId={activeTreeId}
                    role={role}
                    run={run}
                    onEditFamily={() => setEditingHero(true)}
                    onDeleteFamily={() => setShowDeleteConfirm(true)}
                />

                {editingHero && (
                    <div className="family-editor">
                        <FamilyHeroEditor
                            partner1={partner1}
                            partner2={partner2}
                            type={(family.Type ?? 'Unknown') as FamilyType}
                            marriageDate={family.MarriageDate ?? null}
                            marriagePlace={family.MarriagePlace ?? null}
                            marriagePlaceId={family.MarriagePlaceId ?? null}
                            endEvent={endEventOf(details.events)}
                            treeId={activeTreeId}
                            saving={savingHero}
                            canDelete={canDelete}
                            onSave={handleSaveHero}
                            onCancel={() => setEditingHero(false)}
                            onDelete={() => setShowDeleteConfirm(true)}
                        />
                    </div>
                )}

                {[partner1Error && { msg: partner1Error, retry: retryPartner1 }, partner2Error && { msg: partner2Error, retry: retryPartner2 }, citationError && { msg: citationError, retry: retryCitations }]
                    .filter((e): e is { msg: string; retry: () => Promise<void> } => Boolean(e))
                    .map((e, i) => <InlineDataError key={i} message={e.msg} retryLabel={tCommon('retry')} onRetry={e.retry} className="mt-4" />)}

                {/* Dimmed and inert while Edit family is open, so Cancel plainly cancels only it (#759). */}
                <div className={cx(editingHero && 'edit-dimmed')} inert={editingHero}>
                <DetailBody
                    divided
                    index={[
                        { id: 'life-together', label: t('life_together') },
                        { id: 'media', label: t('section_media') },
                        { id: 'notes', label: t('section_notes') },
                        { id: 'sources', label: t('section_sources') },
                    ]}
                    rail={(
                        <FamilyRail
                            family={family}
                            partner1={partner1 ?? null}
                            partner2={partner2 ?? null}
                            partner1Families={partner1Families}
                            partner2Families={partner2Families}
                            childList={children}
                            places={[
                                { place: family.MarriagePlace, placeId: family.MarriagePlaceId },
                                ...(details.events ?? []).map((e) => ({ place: e.Place, placeId: e.PlaceId })),
                                ...children.map((c) => ({ place: c.BirthPlace, placeId: c.BirthPlaceId })),
                            ]}
                            placeCoords={placeCoords}
                            treeId={activeTreeId}
                            canEdit={canEdit}
                            canDelete={canDelete}
                            onChanged={fetchFamily}
                        />
                    )}
                >
                    <section id="life-together" aria-labelledby="life-together-title">
                        <SectionHeader
                            level="label"
                            headingId="life-together-title"
                            title={t('life_together')}
                            action={marks.open.length > 0 ? (
                                <a className="ledger-flag" href={`/data-checks?family=${family.Id}`}>{tChecks('flag_count', { count: marks.open.length })}</a>
                            ) : undefined}
                        />
                        <FamilyTimeline
                            family={{ ...family, events: details.events, marriageMedia: details.marriageMedia, childAdoptions: details.childAdoptions }}
                            childList={children}
                            partners={[partner1, partner2]}
                            relevantPersonIds={relevantPersonIds}
                            citationMap={citationMap}
                            sourceNumbers={sourceNumbers}
                            canEdit={canEdit}
                            canDelete={canDelete}
                            isOpen={isOpen}
                            toggle={toggle}
                            earlierPartner={earlierPartner}
                            marks={marks}
                            onCitationClick={(factTable, factId, factLabel, citation, anchor) => {
                                const fact = familyCitationFacts.find(f => f.factTable === factTable && f.factId === factId)
                                    ?? describeCitationFact(citationMap, factTable, factId, factLabel, factLabel);
                                if (citation && anchor) setCitationPreview({ fact, citation, anchor });
                                // A viewer's pin opens Search records, which only reads (#1028).
                                else if (citationsReady) setAttachTarget({ factTable, factId, factLabel, initialView: canEdit ? 'add' : 'search' });
                            }}
                            onChanged={fetchFamily}
                            footer={canEdit && (showInlineEvent ? (
                                <div className="pt-3">
                                    <InlineEventEditor
                                        target={{ kind: 'family', familyId: parseInt(familyId, 10) }}
                                        relevantPersonIds={relevantPersonIds}
                                        onCancel={() => setShowInlineEvent(false)}
                                        onRefresh={fetchFamily}
                                        onSaved={() => {
                                            setShowInlineEvent(false);
                                            fetchFamily();
                                        }}
                                    />
                                </div>
                            ) : (
                                <AddRow ref={addEventRef} label={t('detail_add_event')} onClick={() => setShowInlineEvent(true)} />
                            ))}
                        />
                    </section>

                    {/* The phone page loads its own notes and media, so hidden desktop
                        copies would only ask for them a second time (#1270). */}
                    {!phoneCites && (
                        <>
                            <section id="media" aria-labelledby="media-title">
                                <SectionHeader level="label" headingId="media-title" title={t('section_media')} count={mediaCount ?? undefined} />
                                <OwnerMediaCard
                                    look="strip"
                                    ownerTable="Families"
                                    ownerId={family.Id}
                                    treeId={activeTreeId}
                                    canEdit={canEdit}
                                    canDelete={canDelete}
                                    relevantPersonIds={relevantPersonIds}
                                    onCount={setMediaCount}
                                />
                            </section>

                            <section id="notes" aria-labelledby="notes-title">
                                <SectionHeader level="label" headingId="notes-title" title={t('section_notes')} count={noteCount || undefined} />
                                <OwnerNotesCard
                                    ownerTable="Families"
                                    ownerId={family.Id}
                                    treeId={activeTreeId}
                                    canEdit={canEdit}
                                    canDelete={canDelete}
                                    // The lead note is About this family, beside the portrait.
                                    showPreferred={false}
                                    refreshKey={notesRefresh}
                                    onNotesChange={(notes) => { setNoteCount(notes.length); setFamilyNotes(notes); }}
                                />
                            </section>
                        </>
                    )}

                    <section id="sources" aria-labelledby="sources-title">
                        <SourcesSection facts={familyCitationFacts} title={t('detail_sources_cited')} />
                    </section>
                </DetailBody>
                </div>
            </PageShell>

            {phoneCites && (
                <CiteSheets
                    target={phoneCiteTarget}
                    subject={ownerTitle}
                    sourceNumbers={sourceNumbers}
                    canCite={canEdit}
                    canDelete={canDelete}
                    research={phoneResearch}
                    onClose={() => { setAttachTarget(null); setCitationPreview(null); }}
                    onChanged={fetchFamily}
                />
            )}

            {!phoneCites && attachTarget && (canEdit || (attachTarget.initialView === 'search' && research)) && citationsReady && attachFact && (
                <CitationDrawer
                    title={ownerTitle}
                    fact={attachFact}
                    canDetach={canDelete}
                    canCite={canEdit}
                    research={research}
                    initialCitationId={attachTarget.initialCitationId}
                    initialView={attachTarget.initialView}
                    onClose={() => setAttachTarget(null)}
                    onChanged={fetchFamily}
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
                        setAttachTarget({ factTable: previewTarget.fact.factTable, factId: previewTarget.fact.factId, factLabel: previewTarget.fact.label, initialCitationId: citation.Id, initialView: 'editor' });
                    }}
                />
            )}

            <ConfirmDialog
                open={showDeleteConfirm}
                variant="calm"
                tone="danger"
                title={t('detail_delete_partnership')}
                body={t('detail_delete_confirm')}
                confirmLabel={tCommon('yes_delete')}
                busy={deleting}
                onConfirm={handleDeleteFamily}
                onCancel={() => setShowDeleteConfirm(false)}
            />
        </>
    );
}
