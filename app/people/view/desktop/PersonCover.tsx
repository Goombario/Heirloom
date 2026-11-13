'use client';

import { useSyncExternalStore } from 'react';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { useTranslations } from 'next-intl';
import type { PersonGalleryMedia, PersonWithRelations } from '@/lib/db/schema';
import type { Note } from '@/lib/data/types';
import { livingStatus } from '@/lib/living';
import { getInitials } from '@/lib/utils/initials';
import ProfileImage from '@/app/components/ProfileImage';
import { CoverBand, Lifespan, RecordMenu, cx, type RecordMenuItem } from '@/app/components/ui';
import { LeadNote } from '@/app/components/notes/LeadNote';
import { avatarClass, fullName } from '../derive';
import { nameBarParts } from '../mobile/model';
import type { RunChange } from '../mobile/useChange';

/**
 * The desktop person page's header (#49): the 144px cover band with the 4:3 portrait
 * hanging over its lower edge, the name and life line, the one ⋯ menu (Edit person,
 * Descendants, Delete person) and the biography beside the portrait.
 */
export function PersonCover({ person, media, treeId, role, biography, bioRequest = 0, run, onEdit, onDescendants, hasDescendants, onDelete, onAddPortrait, onOpenPortrait }: {
  person: PersonWithRelations;
  media: PersonGalleryMedia[];
  treeId: number | null;
  role: 'viewer' | 'contributor' | 'editor';
  biography: Note | null;
  /** Bumped by Notes → Biography: opens the biography editor here. */
  bioRequest?: number;
  run: RunChange;
  onEdit: () => void;
  onDescendants: () => void;
  hasDescendants: boolean;
  onDelete: () => void;
  onAddPortrait: () => void;
  /** Opens the portrait in the lightbox, where it can be changed. */
  onOpenPortrait: (media: PersonGalleryMedia) => void;
}) {
  const t = useTranslations('personDesktop');
  const tp = useTranslations('personDetail');
  const name = fullName(person, tp('unknown'));
  const canWrite = role !== 'viewer';

  const items: RecordMenuItem[] = [
    ...(canWrite ? [{ label: t('edit_person'), onSelect: onEdit }] : []),
    ...(hasDescendants ? [{ label: tp('descendants_label'), onSelect: onDescendants }] : []),
    ...(role === 'editor' ? [{ label: t('delete_person'), danger: true, separated: true, onSelect: onDelete }] : []),
  ];

  const nickname = person.Nickname ?? null;
  const title = (
    <>
      {person.FirstName}
      {nickname && <> “{nickname}”</>}
      {person.LastName && <> {person.LastName}</>}
      {!person.FirstName && !person.LastName && tp('unknown')}
    </>
  );

  // The board's life line: "1894 – 1971 · Uppsala, Sweden to Minneapolis, Minnesota".
  // Places keep their first and last parts; one place, or the same twice, shows once.
  const from = shortPlace(person.BirthPlace);
  const to = shortPlace(person.DeathPlace);
  const places = from && to && from !== to ? t('lifeline_places', { from, to }) : from || to;
  const status = livingStatus(person);
  const hasYears = Boolean(person.BirthDate || person.DeathDate);
  const parts = [
    hasYears ? <Lifespan key="y" birth={person.BirthDate} death={person.DeathDate} status={status} tone="evidence" /> : null,
    places || null,
    status === 'living' ? t('status_living') : null,
  ].filter(Boolean);

  return (
    <CoverBand
      title={title}
      titleSize="hero"
      meta={parts.length > 0 ? (
        <span className="cover-lifeline">
          {parts.map((p, i) => <span key={i}>{i > 0 && ' · '}{p}</span>)}
        </span>
      ) : undefined}
      titleAside={items.length > 0 ? <RecordMenu tone="island" recordName={name} items={items} /> : undefined}
      portrait={<Portrait person={person} media={media} treeId={treeId} canEdit={canWrite} onAdd={onAddPortrait} onOpen={onOpenPortrait} />}
      lead={<Biography person={person} biography={biography} treeId={treeId} canEdit={canWrite} canDelete={role === 'editor'} run={run} request={bioRequest} />}
    />
  );
}

/** "Uppsala, Uppland, Sweden" → "Uppsala, Sweden". */
export function shortPlace(place: string | null | undefined): string {
  const parts = (place ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? `${parts[0]}, ${parts[parts.length - 1]}` : parts[0] ?? '';
}

const noSubscribe = () => () => {};

function Portrait({ person, media, treeId, canEdit, onAdd, onOpen }: {
  person: PersonWithRelations; media: PersonGalleryMedia[]; treeId: number | null; canEdit: boolean;
  onAdd: () => void; onOpen: (m: PersonGalleryMedia) => void;
}) {
  const tp = useTranslations('personDetail');
  const t = useTranslations('personDesktop');
  const photo = media.find((m) => m.IsPersonPrimary);
  const name = fullName(person, tp('unknown'));
  // The 2048px portrait loads eagerly only on a hydrated desktop: phones hide this
  // header behind their own page, and the server can't know the viewport.
  const isMobile = useIsMobile();
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (photo) {
    const focal = photo.TagRegionW != null && photo.TagRegionH != null
      ? { x: (photo.TagRegionX ?? 0) + photo.TagRegionW / 2, y: (photo.TagRegionY ?? 0) + photo.TagRegionH / 2, r: Math.max(photo.TagRegionW, photo.TagRegionH) }
      : { x: photo.FocalX ?? 50, y: photo.FocalY ?? 50, r: photo.FocalRadius ?? null };
    return (
      <button type="button" onClick={() => onOpen(photo)} aria-label={t('open_portrait', { name })}
        className="block rounded-card overflow-hidden cursor-zoom-in focus-ring">
        <ProfileImage mediaId={photo.Id} treeId={treeId} alt={name} focalX={focal.x} focalY={focal.y} focalRadius={focal.r}
          containerWidth={320} containerHeight={240} thumbSize={2048} circular={false}
          loading={hydrated && !isMobile ? 'eager' : 'lazy'} />
      </button>
    );
  }
  return (
    // Initials on the sex colour, the same tile the loading paint and Home show; it
    // fills the 4:3 frame at any width (the portrait narrows to 220px below 1024px).
    <span className={cx('relative grid place-items-center rounded-card overflow-hidden', avatarClass(person.Sex))}>
      <span role="img" aria-label={name} className="cover-portrait__initials serif">{getInitials(person.FirstName, person.LastName)}</span>
      {canEdit && (
        <button type="button" className="hero-portrait-invite" onClick={onAdd} aria-label={tp('add_portrait')}>
          <span aria-hidden="true" className="text-xl leading-[1]">＋</span>
          {tp('add_portrait')}
        </button>
      )}
    </span>
  );
}

/** The biography beside the portrait: the person's lead note. */
function Biography({ person, biography, treeId, canEdit, canDelete, run, request }: {
  person: PersonWithRelations; biography: Note | null; treeId: number | null;
  canEdit: boolean; canDelete: boolean; run: RunChange; request: number;
}) {
  const t = useTranslations('personDesktop');
  const tp = useTranslations('mobileProfile');
  const given = nameBarParts(person).given || tp('this_person');
  return (
    <LeadNote ownerTable="People" ownerId={person.Id} note={biography} treeId={treeId} canEdit={canEdit} canDelete={canDelete} run={run} request={request}
      labels={{
        heading: tp('biography'),
        add: t('add_biography'),
        hint: t('bio_hint', { name: given }),
        edit: t('edit_biography'),
        remove: t('delete_biography'),
        placeholder: tp('bio_placeholder', { name: given }),
        saved: tp('bio_saved'),
        removed: t('bio_removed'),
      }} />
  );
}
