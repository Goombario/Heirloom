'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { useTranslations } from 'next-intl';
import type { PersonGalleryMedia, PersonWithRelations } from '@/lib/db/schema';
import type { Note } from '@/lib/data/types';
import { getDataClient } from '@/lib/data';
import { livingStatus } from '@/lib/living';
import { getInitials } from '@/lib/utils/initials';
import ProfileImage from '@/app/components/ProfileImage';
import { ActionLink, CoverBand, InlinePanel, LeadText, Lifespan, RecordMenu, cx, fieldClass, type RecordMenuItem } from '@/app/components/ui';
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
function shortPlace(place: string | null | undefined): string {
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

/**
 * The biography beside the portrait: three lines and "Read all ⌄", with "Edit
 * biography" opening it in place. It writes the person's preferred note (ADR
 * 0010/0012); a stand-in note (an imported one, #902) becomes the chosen one.
 * Clearing it removes the note from this person, with Undo for editors.
 */
function Biography({ person, biography, treeId, canEdit, canDelete, run, request }: {
  person: PersonWithRelations; biography: Note | null; treeId: number | null;
  canEdit: boolean; canDelete: boolean; run: RunChange; request: number;
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
  // Notes → Biography asks for the editor: bring the cover into view and open it.
  const seen = useRef(request);
  useEffect(() => {
    if (request === seen.current || !canEdit) return;
    seen.current = request;
    setText(biography?.Text ?? '');
    setEditing(true);
    wrap.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [request, canEdit, biography]);

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

  // The board labels the lead "Biography" whenever there is one, or an editor can write one.
  return (
    <div ref={wrap} className="grid gap-1.5">
      {(biography || canEdit) && <h2 className="eyebrow m-0">{tp('biography')}</h2>}
      {body()}
    </div>
  );

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
    return canEdit ? (
      <>
        <span><ActionLink onClick={open}>{t('add_biography')}</ActionLink></span>
        <p className="m-0 text-meta text-text-muted">{t('bio_hint', { name: given })}</p>
      </>
    ) : null;
  }
  return (
    <LeadText onEdit={canEdit ? open : undefined} editLabel={t('edit_biography')}>{biography.Text}</LeadText>
  );
  }
}
