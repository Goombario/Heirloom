'use client';

import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { livingStatus } from '@/lib/living';
import { getDataClient } from '@/lib/data';
import { Users, Network } from '@/lib/icons';
import type { PersonWithRelations, PersonGalleryMedia } from '@/lib/db/schema';
import { calculateAge } from '@/lib/date-utils';
import ProfileImage from '@/app/components/ProfileImage';
import MonogramPortrait from '@/app/components/MonogramPortrait';
import StaticMapPreview from '@/app/components/StaticMapPreview';
import { getInitials } from '@/lib/utils/initials';
import { Button, Lifespan, SourcingMeter, StatusMark } from '@/app/components/ui';
import { Skeleton } from '@/app/components/SkeletonLoader';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { HeroName } from './heroParts';
import { HeroIdentityEditor, type PersonIdentityPatch } from './HeroIdentityEditor';
import type { CitationMap } from './usePersonDetail';
import { factPlaceEntry } from '@/lib/places/place-key';
import {
    fullName, avatarClass, countTotalFacts, countSourcedFacts, countDescendants,
    computeLastEventPlace, splitFirstName, personRoleLabel,
} from './derive';

const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

interface PersonHeroProps {
    person: PersonWithRelations;
    media: PersonGalleryMedia[];
    citationMap: CitationMap;
    placeCoords: Record<string, { lat: number; lng: number }>;
    id: string;
    treeId: number | null;
    canEdit: boolean;
    /** 'owner'/'edit' only — 'contribute' can write but the server rejects deletes. */
    canDelete: boolean;
    hasJourney: boolean;
    onShowJourney: () => void;
    onToggleDescendants: () => void;
    onAddPhoto: () => void;
    /** Hero-only inline identity editor, owned by PersonDetailView. */
    editing: boolean;
    savingIdentity: boolean;
    onStartEdit: () => void;
    onSaveIdentity: (patch: PersonIdentityPatch) => Promise<void>;
    onCancelEdit: () => void;
    onRequestDelete: () => void;
}

export function PersonHero({ person, media, citationMap, placeCoords, id, treeId, canEdit, canDelete, hasJourney, onShowJourney, onToggleDescendants, onAddPhoto, editing, savingIdentity, onStartEdit, onSaveIdentity, onCancelEdit, onRequestDelete }: PersonHeroProps) {
    const router = useRouter();
    const t = useTranslations('personDetail');
    const tc = useTranslations('common');
    const isMobile = useIsMobile();
    const viewportResolved = useSyncExternalStore(
        subscribeToHydration,
        getClientHydrationSnapshot,
        getServerHydrationSnapshot,
    );

    const primaryPhoto = media.find(m => m.IsPersonPrimary);
    const primaryFocal = primaryPhoto
        ? (primaryPhoto.TagRegionW != null && primaryPhoto.TagRegionH != null
            ? {
                x: (primaryPhoto.TagRegionX ?? 0) + primaryPhoto.TagRegionW / 2,
                y: (primaryPhoto.TagRegionY ?? 0) + primaryPhoto.TagRegionH / 2,
                radius: Math.max(primaryPhoto.TagRegionW, primaryPhoto.TagRegionH),
            }
            : { x: primaryPhoto.FocalX ?? 50, y: primaryPhoto.FocalY ?? 50, radius: primaryPhoto.FocalRadius ?? null })
        : null;
    const ageResult = calculateAge(person.BirthDate, person.DeathDate, person.IsDeceased === 1);
    // "aged 71". A dateless deceased person gets no age: the status word already says so.
    const age = ageResult == null || ageResult.kind === 'deceased' ? null
        : ageResult.kind === 'months' ? t('age_months', { count: ageResult.value })
        : ageResult.kind === 'years_approx' ? t('age_years_approx', { count: ageResult.value })
        : t('age_years', { count: ageResult.value });
    // Three states, matching the People list: a person with no death data and no
    // explicit living flag is unknown, not living.
    const status = livingStatus(person);
    const statusWord = status === 'living' ? tc('living') : status === 'deceased' ? tc('deceased') : tc('unknown');
    // "X/Y sourced" — same fact accounting as the people list page (SQL
    // TotalFacts/SourcedFacts), so the ratio means the same thing on both surfaces.
    const totalFacts = countTotalFacts(person);
    const sourcedFacts = countSourcedFacts(person, citationMap);
    // The button counts EVERY descendant, not just direct children. The loaded
    // person carries a single generation, so the total comes from the dedicated
    // count endpoint (one integer — the descendants TREE endpoint would ship the
    // whole tree for this). The direct-children count is exact at ZERO, which is
    // all it is used for here: it decides whether the button exists at all,
    // without a request.
    //
    // It is NOT used as a stand-in figure any more. Painting it first and then
    // swapping in the real total meant the user read a confident number that then
    // changed under them (#435) — worse than no number. The button holds a
    // skeleton until the real count resolves.
    const directChildren = countDescendants(person);
    // Stamped with the person it was counted for, so navigating to another person
    // shows their own pending state instead of the previous person's total.
    // `count: null` = the request failed; the button then drops the figure rather
    // than sitting on a skeleton forever.
    const [subtree, setSubtree] = useState<{ id: number; count: number | null } | null>(null);
    useEffect(() => {
        if (directChildren === 0) return;
        let cancelled = false;
        getDataClient()
            .then(client => client.people.descendantCount(person.Id, treeId))
            .catch(() => null)
            .then(count => {
                if (cancelled) return;
                setSubtree({ id: person.Id, count: count ?? null });
            });
        return () => { cancelled = true; };
    }, [person.Id, treeId, directChildren]);
    const descendantCount = subtree?.id === person.Id ? subtree.count : undefined;
    const hasDescendants = directChildren > 0;
    // Label, skeleton, or the bare word — never a provisional number.
    const descendantsLabel: React.ReactNode =
        descendantCount === undefined
            ? <Skeleton className="h-3 w-20 rounded" />
            : descendantCount === null
                ? t('descendants_label')
                : t('descendants_count', { count: descendantCount });
    const nickname = person.Nickname ?? null;
    const { firstWord, rest: restOfFirstName } = splitFirstName(person.FirstName);
    const partnerships = person.spouses ?? [];
    const hasRole = partnerships.length > 0 || (person.familiesAsSpouse?.length ?? 0) > 0;
    const lastEvent = computeLastEventPlace(person);
    const lastEventPlace = lastEvent?.place ?? null;
    const lastCoords = lastEvent ? factPlaceEntry(placeCoords, lastEvent.place, lastEvent.placeId) : undefined;

    const avatar = (size: number, fontSize: number) => (
        <div className="rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ width: size, height: size, border: '3px solid var(--color-border)' }}>
            {primaryPhoto?.Id ? (
                <ProfileImage
                    mediaId={primaryPhoto.Id}
                    treeId={treeId}
                    alt={fullName(person, t('unknown'))}
                    focalX={primaryFocal?.x ?? 50}
                    focalY={primaryFocal?.y ?? 50}
                    focalRadius={primaryFocal?.radius ?? null}
                    containerWidth={size}
                    containerHeight={size}
                    circular={true}
                    loading="eager"
                />
            ) : (
                <div className={`${avatarClass(person.Sex)} flex items-center justify-center font-semibold`} style={{ width: '100%', height: '100%', color: 'var(--color-on-media)', fontSize }}>
                    {getInitials(person.FirstName, person.LastName)}
                </div>
            )}
        </div>
    );

    // Desktop hero: framed rectangular portrait (real photo or engraved-monogram
    // placeholder) with a museum mat. Mobile keeps the compact circle. No date plate:
    // it repeated the lifespan line beside it (#766).
    const FRAME = 150;
    const framedPortrait = (
        <div className="relative shrink-0 self-center">
            <div className="hero-portrait-frame" style={{ width: FRAME, height: FRAME }}>
                {primaryPhoto?.Id ? (
                    <ProfileImage
                        mediaId={primaryPhoto.Id}
                        treeId={treeId}
                        alt={fullName(person, t('unknown'))}
                        focalX={primaryFocal?.x ?? 50}
                        focalY={primaryFocal?.y ?? 50}
                        focalRadius={primaryFocal?.radius ?? null}
                        containerWidth={FRAME}
                        containerHeight={FRAME}
                        thumbSize={2048}
                        circular={false}
                        loading={isMobile || !viewportResolved ? 'lazy' : 'eager'}
                    />
                ) : (
                    <>
                        <MonogramPortrait
                            initials={getInitials(person.FirstName, person.LastName)}
                            sex={person.Sex}
                            label={fullName(person, t('unknown'))}
                            size={FRAME}
                        />
                        {canEdit && (
                            <button type="button" className="hero-portrait-invite" onClick={onAddPhoto} aria-label={t('add_portrait')}>
                                <span aria-hidden="true" className="text-xl leading-[1]">＋</span>
                                {t('add_portrait')}
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );

    const nameContent = (
        <>
            {firstWord}
            {nickname && <> “{nickname}”</>}
            {restOfFirstName && <span style={{ opacity: 0.62 }}> {restOfFirstName}</span>}
            {person.LastName && <> {person.LastName}</>}
        </>
    );

    // The full lifespan, shared by both layouts (#766, DV-1). The age follows it once.
    const datesInline = (
        <Lifespan
            variant="full"
            birth={person.BirthDate}
            death={person.DeathDate}
            birthPlace={person.BirthPlace}
            deathPlace={person.DeathPlace}
        />
    );

    const sexLabel = person.Sex
        ? (person.Sex === 'M' ? t('sex_male') : person.Sex === 'F' ? t('sex_female') : t('sex_nonbinary'))
        : null;
    // Sex and role are facts about the person, not states, so they read as a text
    // line rather than tags (audit §13 addendum, 2026-09-23).
    const factsLine = [sexLabel, hasRole ? personRoleLabel(person, t) : null].filter(Boolean).join(' · ');

    const metaLine = (
        <>
            <span className="inline-flex items-center gap-1.5 text-sm text-text">
                <StatusMark status={status} />
                {statusWord}
            </span>
            {factsLine && <span className="text-sm text-text-muted">{factsLine}</span>}
            <SourcingMeter
                sourced={sourcedFacts}
                total={totalFacts}
                label={t('facts_sourced', { sourced: sourcedFacts, total: totalFacts })}
                info={{ label: t('facts_sourced_info_label'), text: t('facts_sourced_info') }}
            />
        </>
    );

    const placeLabel = (
        <span className="block text-meta leading-snug" style={{ color: 'var(--color-text-muted)' }}>
            {lastEventPlace}
        </span>
    );

    // The hero renders a mobile and a desktop copy; closing the editor returns focus
    // to whichever Edit is showing (#798, KB-2).
    const mobileEditRef = useRef<HTMLButtonElement>(null);
    const desktopEditRef = useRef<HTMLButtonElement>(null);
    const wasEditing = useRef(editing);
    useEffect(() => {
        if (wasEditing.current && !editing) {
            [mobileEditRef.current, desktopEditRef.current].find((b) => b && b.getClientRects().length > 0)?.focus();
        }
        wasEditing.current = editing;
    }, [editing]);

    const editButton = (size: 'sm' | 'md') => canEdit ? (
        <Button ref={size === 'sm' ? mobileEditRef : desktopEditRef} variant="tonal" size={size} onClick={onStartEdit}>
            {tc('edit')}
        </Button>
    ) : null;

    return (
        <>
            {/* Mobile hero — compact card (md:hidden) */}
            <div className="hero-dark md:hidden relative mb-6 rounded-[16px] p-4">
                <div className="flex gap-3.5 items-center">
                    {avatar(82, 26)}
                    {!editing && (
                        <div className="flex-1 min-w-0">
                            <HeroName size="sm">{nameContent}</HeroName>
                            <div className="leading-[1.45]" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                                {datesInline}
                                {age && <><br /><span style={{ opacity: 0.85 }}>· {age}</span></>}
                            </div>
                        </div>
                    )}
                </div>

                {editing ? (
                    <div className="mt-3">
                        <HeroIdentityEditor
                            person={person}
                            onSave={onSaveIdentity}
                            onDelete={onRequestDelete}
                            onCancel={onCancelEdit}
                            saving={savingIdentity}
                            canDelete={canDelete}
                        />
                    </div>
                ) : (
                    <>
                        <div className="flex gap-x-3 gap-y-1.5 flex-wrap items-center mt-[13px]">
                            {metaLine}
                        </div>

                        {/* Edit leads the action row as a copper wash; the rest is navigation. */}
                        <div className="flex gap-2 mt-[13px] flex-wrap">
                            {editButton('sm')}
                            <Button variant="outline" size="sm" icon={<Network width={15} height={15} aria-hidden="true" />} onClick={() => router.push(`/tree?rootId=${id}`)}>
                                {t('view_in_tree')}
                            </Button>
                            {hasDescendants && (
                                <Button variant="outline" size="sm" icon={<Users width={15} height={15} aria-hidden="true" />} onClick={onToggleDescendants} aria-busy={descendantCount === undefined}>
                                    {descendantsLabel}
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Desktop hero — portrait + geo rail (hidden md:block) */}
            <div className="hidden md:block">
                <div className="hero-flex hero-dark mb-6 flex-wrap">
                    {/* Framed portrait — photo or engraved-monogram placeholder */}
                    {framedPortrait}

                    {editing ? (
                        <HeroIdentityEditor
                            person={person}
                            onSave={onSaveIdentity}
                            onDelete={onRequestDelete}
                            onCancel={onCancelEdit}
                            saving={savingIdentity}
                            canDelete={canDelete}
                        />
                    ) : (
                        <div className="flex-1 min-w-[240px]">
                            <div>
                                {person.LastName && (
                                    <div className="tracking-[0.08em] uppercase mb-2" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                                        {t('family_eyebrow', { surname: person.LastName })}
                                    </div>
                                )}
                                <HeroName size="lg">{nameContent}</HeroName>
                            </div>
                            <div className="text-base" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
                                {datesInline}
                                {age && <span> &nbsp;·&nbsp; {age}</span>}
                            </div>

                            <div className="row gap-x-3 gap-y-1.5 flex-wrap mb-3.5">
                                {metaLine}
                            </div>
                            <div className="row gap-2 flex-wrap">
                                {/* Descendants follows View in tree (matching the mobile
                                    hero). Reordered in the JSX, not with CSS order, so tab
                                    order tracks the visual order. Edit leads as a copper wash. */}
                                {editButton('md')}
                                <Button variant="outline" onClick={() => router.push(`/tree?rootId=${id}`)}>
                                    {t('view_in_tree')}
                                </Button>
                                {hasDescendants && (
                                    <Button variant="outline" onClick={onToggleDescendants} aria-busy={descendantCount === undefined}>
                                        {descendantsLabel}
                                    </Button>
                                )}
                                {/* With no mini-map to click, the journey keeps a way in. */}
                                {!lastCoords && hasJourney && (
                                    <Button variant="outline" onClick={onShowJourney}>
                                        {tc('view_journey')}
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Mini-map of the last known place — only when that place has
                        coordinates; otherwise the identity block takes the full width
                        (FR-8, #741). Hidden while editing so the editor gets the width. */}
                    {!editing && lastCoords && (
                    <div className="hero-geo shrink-0 self-stretch gap-1.5 min-w-[140px]">
                        <StaticMapPreview
                            lat={lastCoords.lat}
                            lng={lastCoords.lng}
                            label={lastEventPlace!}
                            onClick={hasJourney ? onShowJourney : undefined}
                            fill
                            className="hero-geo-map"
                        />
                        {placeLabel}
                    </div>
                    )}
                </div>
            </div>
        </>
    );
}
