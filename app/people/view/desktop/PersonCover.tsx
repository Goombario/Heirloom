'use client';

import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { useTranslations } from 'next-intl';
import type { PersonGalleryMedia, PersonWithRelations } from '@/lib/db/schema';
import type { Note } from '@/lib/data/types';
import { getDataClient } from '@/lib/data';
import { calculateAge } from '@/lib/date-utils';
import { getInitials } from '@/lib/utils/initials';
import ProfileImage from '@/app/components/ProfileImage';
import { WarningDot } from '@/app/components/ui/DatesToCheckFlag';
import { ActionLink, CoverBand, InlinePanel, LeadText, Lifespan, RecordMenu, cx, fieldClass, type RecordMenuItem } from '@/app/components/ui';
import { avatarClass, fullName } from '../derive';
import { nameBarParts } from '../mobile/model';
import type { RunChange } from '../mobile/useChange';

/**
 * The desktop person page's header (#49): the 144px cover band with the 4:3 portrait
 * hanging over its lower edge, the name and life line, the one ⋯ menu (Edit person,
 * Descendants, Delete person) and the biography beside the portrait.
 */
export function PersonCover({ person, media, treeId, role, datesToCheck, biography, run, onEdit, onDescendants, hasDescendants, onDelete, onAddPortrait, onOpenPortrait }: {
  person: PersonWithRelations;
  media: PersonGalleryMedia[];
  treeId: number | null;
  role: 'viewer' | 'contributor' | 'editor';
  /** Open dates to check on this person (#833): the header pill. */
  datesToCheck: number;
  biography: Note | null;
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
  const td = useTranslations('dataChecks');
  const name = fullName(person, tp('unknown'));
  const canWrite = role !== 'viewer';

  const items: RecordMenuItem[] = [
    ...(canWrite ? [{ label: t('edit_person'), onSelect: onEdit }] : []),
    ...(hasDescendants ? [{ label: tp('descendants_label'), onSelect: onDescendants }] : []),
    ...(role === 'editor' ? [{ label: t('delete_person'), danger: true, separated: true, onSelect: onDelete }] : []),
  ];

  const ageResult = calculateAge(person.BirthDate, person.DeathDate, person.IsDeceased === 1);
  const age = ageResult == null || ageResult.kind === 'deceased' ? null
    : ageResult.kind === 'months' ? tp('age_months', { count: ageResult.value })
      : ageResult.kind === 'years_approx' ? tp('age_years_approx', { count: ageResult.value })
        : tp('age_years', { count: ageResult.value });

  const nickname = person.Nickname ?? null;
  const title = (
    <>
      {person.FirstName}
      {nickname && <> “{nickname}”</>}
      {person.LastName && <> {person.LastName}</>}
      {!person.FirstName && !person.LastName && tp('unknown')}
    </>
  );

  return (
    <CoverBand
      title={title}
      titleSize="hero"
      meta={(
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <Lifespan variant="full" birth={person.BirthDate} death={person.DeathDate} birthPlace={person.BirthPlace} deathPlace={person.DeathPlace} />
          {age && <span>· {age}</span>}
          {datesToCheck > 0 && (
            <span className="inline-flex items-center gap-1.5 min-h-6 rounded-full border border-warning-border bg-warning-bg text-warning-text py-px pl-[3px] pr-2.5 text-meta font-semibold whitespace-nowrap">
              <WarningDot />{td('flag_count', { count: datesToCheck })}
            </span>
          )}
        </span>
      )}
      actions={items.length > 0 ? <RecordMenu tone="island" recordName={name} items={items} /> : undefined}
      portrait={<Portrait person={person} media={media} treeId={treeId} canEdit={canWrite} onAdd={onAddPortrait} onOpen={onOpenPortrait} />}
      lead={<Biography person={person} biography={biography} treeId={treeId} canEdit={canWrite} canDelete={role === 'editor'} run={run} />}
    />
  );
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
      <span role="img" aria-label={name} className="serif text-5xl text-[color:var(--color-on-media)] opacity-70">{getInitials(person.FirstName, person.LastName)}</span>
      {canEdit && (
        <button type="button" className="hero-portrait-invite" onClick={onAdd} aria-label={tp('add_portrait')}>
          <span aria-hidden="true" className="text-xl leading-[1]">＋</span>
          {tp('add_portrait')}
        </button>
      )}
    </span>
  );
}

/**
 * The biography beside the portrait: three lines and "Read all ⌄", with "Edit
 * biography" opening it in place. It writes the person's preferred note (ADR
 * 0010/0012); a stand-in note (an imported one, #902) becomes the chosen one.
 * Clearing it removes the note from this person, with Undo for editors.
 */
function Biography({ person, biography, treeId, canEdit, canDelete, run }: {
  person: PersonWithRelations; biography: Note | null; treeId: number | null;
  canEdit: boolean; canDelete: boolean; run: RunChange;
}) {
  const t = useTranslations('personDesktop');
  const tp = useTranslations('mobileProfile');
  const ids = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  // Closing hands focus back to whichever link opened the panel (#690).
  const wrap = useRef<HTMLDivElement>(null);
  const given = nameBarParts(person).given || tp('this_person');
  const saved = biography?.Text ?? '';

  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => Array.from(wrap.current?.querySelectorAll<HTMLElement>('button') ?? []).pop()?.focus());
  };
  const open = () => { setText(saved); setEditing(true); };

  const save = async () => {
    const body = text.trim();
    if (saving) return;
    if (body === saved.trim()) { close(); return; }
    if (!body) { await remove(); return; }
    setSaving(true);
    const ok = await run(async () => {
      const client = await getDataClient();
      const auditIds: number[] = [];
      let id = biography?.Id;
      if (biography) {
        auditIds.push(...(await client.notes.update(biography.Id, 'People', person.Id, body, treeId)).auditIds);
      } else {
        const note = await client.notes.create('People', person.Id, body, treeId);
        auditIds.push(...note.auditIds);
        id = note.Id;
      }
      if (id != null && biography?.IsPrimary !== 1) {
        auditIds.push(...(await client.notes.setPrimary(id, 'People', person.Id, true, treeId)).auditIds);
      }
      return { auditIds };
    }, { message: tp('bio_saved') });
    setSaving(false);
    if (ok) close();
  };

  const remove = async () => {
    if (!biography) { close(); return; }
    setSaving(true);
    // Unlinking deletes the note only when no other record still points at it.
    const ok = await run(async () => {
      const client = await getDataClient();
      return client.notes.remove(biography.Id, 'People', person.Id, treeId);
    }, { message: t('bio_removed') });
    setSaving(false);
    if (ok) close();
  };

  return <div ref={wrap}>{body()}</div>;

  function body() {
  if (editing) {
    return (
      <InlinePanel
        label={t('edit_biography')}
        onSave={save}
        onCancel={close}
        saving={saving}
        dirty={text.trim() !== saved.trim()}
        onDelete={canDelete && biography ? remove : undefined}
        deleteLabel={t('delete_biography')}
      >
        <label htmlFor={`${ids}-bio`} className="sr-only">{tp('biography')}</label>
        <textarea
          id={`${ids}-bio`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={20000}
          rows={6}
          placeholder={tp('bio_placeholder', { name: given })}
          className={cx(fieldClass(), 'serif text-md leading-relaxed resize-y min-h-[140px]')}
        />
      </InlinePanel>
    );
  }
  if (!biography) {
    return canEdit
      ? <ActionLink onClick={open}>{t('add_biography')}</ActionLink>
      : null;
  }
  return (
    <LeadText onEdit={canEdit ? open : undefined} editLabel={t('edit_biography')}>{biography.Text}</LeadText>
  );
  }
}
