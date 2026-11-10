'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import PersonAvatar from '@/app/components/PersonAvatar';
import PersonPicker, { type PersonPickerHandle } from '@/app/components/PersonPicker';
import { Badge, Button, Lifespan } from '@/app/components/ui';
import { cx } from '@/app/components/ui/cx';
import { useMenuKeyboard } from '@/app/components/ui/useMenuKeyboard';
import { Check, ChevronDown, Ellipsis, X } from '@/lib/icons';
import { initialsFromName } from '@/lib/utils/initials';
import type { FaceDismissReason, FaceMatchKind, MediaFaceCandidate } from '@/lib/db/schema';
import type { FacePersonRef } from '@/lib/db/queries/media-faces';
import { FaceCropThumb, FacePhotoWithBox } from './FaceCropThumb';
import {
  faceRefFromResult, fitsPhoto, photoCount, photoYear, sharedNameNote, type FaceRow,
} from './faceRows';

/** The row grid: a 4-column table at lg, stacked name / faces / who below it (tablet). */
const ROW_GRID = cx(
  'grid gap-x-5 gap-y-3 items-center',
  'grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:"name_acts""faces_faces""who_who"]',
  'lg:grid-cols-[180px_minmax(0,1fr)_240px_112px] lg:[grid-template-areas:"name_faces_who_acts"]',
);

export interface FaceRowActions {
  canEdit: boolean;
  busy: boolean;
  treeId: number | null;
  onPick: (row: FaceRow, person: FacePersonRef) => void;
  onTag: (row: FaceRow) => void;
  onDismiss: (row: FaceRow, candidates: MediaFaceCandidate[], reason: FaceDismissReason) => void;
  onSplitNot: (row: FaceRow, candidate: MediaFaceCandidate) => void;
  onEachFace: (row: FaceRow) => void;
  onOpenPhoto: (candidate: MediaFaceCandidate) => void;
}

/** What happened to a row, shown in its place with Undo (#1156). */
export interface SettledFaceRow {
  key: string;
  name: string;
  candidates: MediaFaceCandidate[];
  outcome: { kind: 'tagged'; person: string } | { kind: 'dismissed'; reason: FaceDismissReason };
}

/** The match state as a small pill: Matched, Similar name, shared, Needs a name, You chose. */
function FaceStatePill({ kind, sharedCount, className }: { kind: FaceMatchKind; sharedCount: number; className?: string }) {
  const ft = useTranslations('faceTags');
  const label = faceStateLabel(ft, kind, sharedCount);
  const tone = kind === 'exact' || kind === 'variant' ? 'green' : kind === 'chosen' ? 'outline' : 'warning';
  return <Badge tone={tone} shape="pill" className={cx('min-w-0 font-semibold', kind === 'chosen' && 'bg-surface-2 text-text-secondary', className)}><span className="truncate">{label}</span></Badge>;
}

export function faceStateLabel(ft: ReturnType<typeof useTranslations>, kind: FaceMatchKind, sharedCount: number): string {
  return kind === 'exact' ? ft('match_matched')
    : kind === 'variant' ? ft('match_via_variant')
      : kind === 'chosen' ? ft('match_chosen')
        : kind === 'ambiguous' ? ft('match_ambiguous', { count: sharedCount })
          : ft('match_needs_name');
}

/** Closes on an outside press; Escape is each popover's own key handler. */
function useOutsidePress(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, ref, close]);
}

/** A small action menu (row ⋯ and a face's ×): role=menu with the shared keyboard contract. */
function ActionMenu({ label, trigger, triggerClassName, items, align = 'end' }: {
  label: string;
  trigger: ReactNode;
  triggerClassName: string;
  items: { label: string; hint?: string; onSelect: () => void }[];
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = (returnFocus: boolean) => { setOpen(false); if (returnFocus) triggerRef.current?.focus(); };
  const onKeyDown = useMenuKeyboard({ open, menuRef, onClose: close });
  useOutsidePress(open, wrap, () => setOpen(false));
  return (
    <div ref={wrap} className="contents">
      <button ref={triggerRef} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(o => !o)} className={cx(triggerClassName, open && 'opacity-100')}>
        {trigger}
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label={label} onKeyDown={onKeyDown}
          className={cx('absolute top-full z-40 mt-1 w-60 rounded-lg border border-border bg-card p-1.5 shadow-[var(--shadow-lg)]', align === 'end' ? 'right-0' : 'left-0')}>
          {items.map(item => (
            <button key={item.label} type="button" role="menuitem" tabIndex={-1}
              onClick={() => { setOpen(false); item.onSelect(); }}
              className="flex w-full min-h-9 items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm text-text hover:bg-hover-surface focus-ring-inset cursor-pointer">
              <span>{item.label}</span>
              {item.hint && <span className="shrink-0 text-xs text-text-muted">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One face crop: click for its photo; hover × for Not {person}, Not a face, Can't identify. */
function FaceCrop({ row, candidate, actions }: { row: FaceRow; candidate: MediaFaceCandidate; actions: FaceRowActions }) {
  const ft = useTranslations('faceTags');
  const [peek, setPeek] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useOutsidePress(peek, wrap, () => setPeek(false));
  useEffect(() => { if (peek) dialog.current?.focus(); }, [peek]);
  const title = candidate.MediaTitle || ft('face_card_title');
  const year = photoYear(candidate);
  const people = candidate.MediaPeopleCount ?? 0;
  const notWho = row.person?.name ?? (row.candidates.length > 1 ? null : undefined);
  const items = [
    ...(notWho !== undefined ? [{
      label: notWho ? ft('action_not_person', { name: notWho }) : ft('action_not_same'),
      hint: ft('action_own_row'),
      onSelect: () => actions.onSplitNot(row, candidate),
    }] : []),
    { label: ft('action_not_a_face'), onSelect: () => actions.onDismiss(row, [candidate], 'not-a-face') },
    { label: ft('action_cant_identify_one'), onSelect: () => actions.onDismiss(row, [candidate], 'unidentified') },
  ];

  return (
    <div ref={wrap} className="group/face relative shrink-0">
      <FaceCropThumb candidate={candidate} treeId={actions.treeId} size={60} label={ft('show_photo', { title })} onClick={() => setPeek(p => !p)} />
      {actions.canEdit && !actions.busy && (
        <ActionMenu label={ft('face_options')} align="start" items={items}
          trigger={<X size={13} strokeWidth={2.5} aria-hidden="true" />}
          triggerClassName="absolute right-1 top-1 grid h-[22px] w-[22px] place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover/face:opacity-100 focus-visible:opacity-100 cursor-pointer focus-ring" />
      )}
      {peek && (
        <div ref={dialog} role="dialog" aria-label={ft('peek_label')} tabIndex={-1}
          onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setPeek(false); } }}
          className="absolute left-0 top-full z-40 mt-2 w-[360px] rounded-lg border border-border bg-card p-2.5 shadow-[var(--shadow-lg)] focus:outline-none">
          <FacePhotoWithBox candidate={candidate} treeId={actions.treeId} width={720} />
          <p className="m-0 mt-2 text-sm text-text">{title}</p>
          <p className="m-0 text-meta text-text-muted">
            {year != null ? ft('peek_meta_year', { year, count: people }) : ft('peek_meta', { count: people })}
          </p>
          <div className="mt-1.5 flex items-center justify-between">
            <button type="button" onClick={() => { setPeek(false); actions.onOpenPhoto(candidate); }}
              className="rounded-md px-1 py-1.5 text-sm text-link hover:underline cursor-pointer focus-ring">{ft('open_photo')}</button>
            <button type="button" onClick={() => setPeek(false)}
              className="rounded-md px-2 py-1.5 text-sm text-link hover:bg-hover-surface cursor-pointer focus-ring">{ft('peek_close')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PersonLine({ person, treeId }: { person: FacePersonRef; treeId: number | null }) {
  return (
    <>
      <PersonAvatar as="span" size={24} name={person.name} initials={initialsFromName(person.name)} sex={person.sex} treeId={treeId}
        mediaId={person.mediaId ?? undefined} focalX={person.focalX ?? undefined} focalY={person.focalY ?? undefined} focalRadius={person.focalRadius ?? undefined} />
      <span className="serif min-w-0 truncate text-sm font-semibold">{person.name}</span>
      {(person.birthYear || person.deathYear) && (
        <span className="shrink-0 text-xs text-text-muted"><Lifespan birth={person.birthYear} death={person.deathYear} preformatted /></span>
      )}
    </>
  );
}

/** The person popover: Suggested, then a search over everyone. Picking fills the row. */
function PersonPopover({ row, suggested, actions, onClose }: { row: FaceRow; suggested: FacePersonRef[]; actions: FaceRowActions; onClose: () => void }) {
  const ft = useTranslations('faceTags');
  const picker = useRef<PersonPickerHandle>(null);
  useEffect(() => { const raf = requestAnimationFrame(() => picker.current?.focus()); return () => cancelAnimationFrame(raf); }, []);
  const pick = (p: FacePersonRef) => { onClose(); actions.onPick(row, p); };
  return (
    <div role="dialog" aria-label={ft('picker_label')}
      onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      className="absolute right-0 top-full z-40 mt-1.5 w-[300px] rounded-lg border border-border bg-card p-1.5 shadow-[var(--shadow-lg)]">
      {suggested.length > 0 && (
        <>
          <div className="eyebrow px-2.5 pt-1.5 pb-0.5">{ft('picker_suggested')}</div>
          {suggested.map(p => (
            <button key={p.id} type="button" onClick={() => pick(p)}
              className="flex w-full min-h-9 items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-hover-surface cursor-pointer focus-ring-inset">
              <PersonLine person={p} treeId={actions.treeId} />
            </button>
          ))}
          <div className="my-1 border-t border-border" />
        </>
      )}
      <div className="eyebrow px-2.5 pt-1.5 pb-1">{ft('picker_everyone')}</div>
      <div className="px-1 pb-1">
        <PersonPicker ref={picker} inline value={null} showDates treeId={actions.treeId}
          onChange={(p) => { if (p) pick(faceRefFromResult(p)); }} />
      </div>
    </div>
  );
}

/** Who it is: the person field, or radio rows for a shared name. */
function WhoField({ row, actions }: { row: FaceRow; actions: FaceRowActions }) {
  const ft = useTranslations('faceTags');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useOutsidePress(open, wrap, () => setOpen(false));
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const suggested = row.sharedBy.length > 0 ? row.sharedBy : row.group.ambiguousCandidates.length > 0
    ? row.group.ambiguousCandidates : row.group.suggestedPerson ? [row.group.suggestedPerson] : [];
  const disabled = !actions.canEdit || actions.busy;

  if (row.sharedBy.length > 0 && !row.person) {
    const note = sharedNameNote(row);
    const year = row.perFace ? photoYear(row.candidates[0]) : null;
    return (
      <div ref={wrap} className="relative flex flex-col gap-1">
        {note && (
          <p className="m-0 mb-1 border-l-[3px] border-evidence py-px pl-2.5 text-xs leading-snug text-text-secondary">
            {note.kind === 'span'
              ? ft('note_span', { from: note.from, to: note.to, name: note.name, born: note.born })
              : ft.rich('note_likely', { year: note.year, out: note.out, likely: note.likely, b: (c) => <b className="font-semibold text-text">{c}</b> })}
          </p>
        )}
        <div role="radiogroup" aria-label={ft('ambiguous_candidates_label')} className="flex flex-col gap-1">
          {row.sharedBy.map(p => {
            const fits = fitsPhoto(p, year);
            return (
              <button key={p.id} type="button" role="radio" aria-checked={false} disabled={disabled || !fits}
                onClick={() => actions.onPick(row, p)}
                className={cx('flex w-full min-h-9 items-center gap-2 rounded-[9px] border border-border px-2.5 py-1 text-left text-sm focus-ring',
                  fits ? 'enabled:hover:border-text-muted enabled:cursor-pointer' : 'border-dashed opacity-55')}>
                <span aria-hidden="true" className={cx('h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-text-muted', !fits && 'border-dashed')} />
                <span className="min-w-0 truncate font-medium">{p.name}</span>
                {(p.birthYear || p.deathYear) && <span className="ml-auto shrink-0 text-xs text-text-muted"><Lifespan birth={p.birthYear} death={p.deathYear} preformatted /></span>}
              </button>
            );
          })}
        </div>
        {actions.canEdit && (
          <div className="flex flex-wrap gap-1.5">
            <button ref={trigger} type="button" disabled={disabled} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog"
              className="rounded-md px-1 py-0.5 text-xs text-link hover:bg-hover-surface cursor-pointer focus-ring disabled:opacity-50">{ft('action_someone_else')}</button>
            {!row.perFace && row.candidates.length > 1 && (
              <button type="button" disabled={disabled} onClick={() => actions.onEachFace(row)}
                className={cx('rounded-md px-1 py-0.5 text-xs text-link hover:bg-hover-surface cursor-pointer focus-ring disabled:opacity-50',
                  note && 'font-semibold underline underline-offset-[3px]')}>{ft('action_each_face')}</button>
            )}
          </div>
        )}
        {open && <PersonPopover row={row} suggested={[]} actions={actions} onClose={close} />}
      </div>
    );
  }

  const field = 'flex w-full min-h-9 items-center gap-2 rounded-[9px] border border-border bg-card px-2.5 py-1.5 text-left';
  if (!actions.canEdit) {
    return row.person
      ? <div className={field}><PersonLine person={row.person} treeId={actions.treeId} /></div>
      : <div className={cx(field, 'border-dashed text-sm text-text-muted')}>{ft('match_needs_name')}</div>;
  }
  return (
    <div ref={wrap} className="relative">
      <button ref={trigger} type="button" disabled={disabled} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={row.person ? ft('change_person', { name: row.person.name }) : undefined}
        className={cx(field, 'cursor-pointer enabled:hover:border-text-muted focus-ring disabled:opacity-60',
          !row.person && 'border-dashed bg-transparent text-sm text-text-muted')}>
        {row.person ? <PersonLine person={row.person} treeId={actions.treeId} /> : ft('action_choose_person')}
        <ChevronDown size={14} aria-hidden="true" className="ml-auto shrink-0 text-text-muted" />
      </button>
      {open && <PersonPopover row={row} suggested={suggested.filter(p => p.id !== row.person?.id)} actions={actions} onClose={close} />}
    </div>
  );
}

function rowName(row: FaceRow, unknown: string): string {
  return row.group.sourceName ?? unknown;
}

/** One name from the photos: Named in the photo / Faces / Who it is / Tag N and ⋯. */
export function FaceDecisionRow({ row, actions, anchorId, rowRef }: {
  row: FaceRow; actions: FaceRowActions; anchorId: string; rowRef?: (node: HTMLDivElement | null) => void;
}) {
  const ft = useTranslations('faceTags');
  const tc = useTranslations('common');
  const name = rowName(row, tc('unknown'));
  const n = row.candidates.length;
  return (
    <div ref={rowRef} id={anchorId} tabIndex={-1} data-testid="face-row"
      className={cx(ROW_GRID, 'scroll-mt-[calc(var(--nav-h)+1.5rem)] border-b border-border-light px-4 py-3.5 last:border-b-0 focus-ring')}>
      <div className="min-w-0 [grid-area:name]">
        <h3 className="serif m-0 text-lg font-semibold leading-tight">{name}</h3>
        <div className="mt-1 flex flex-col items-start gap-1 text-xs text-text-muted">
          <FaceStatePill kind={row.kind} sharedCount={row.sharedBy.length || row.group.ambiguousPersonCount || 0} />
          <span>
            {row.perFace ? ft('face_of', { index: row.perFace.index, of: row.perFace.of, name })
              : row.splitFrom ? ft('split_not', { name: row.splitFrom })
                : ft('group_faces_photos', { faces: n, photos: photoCount(row.candidates) })}
          </span>
        </div>
      </div>
      <div role="group" aria-label={ft('col_faces')} className="flex min-w-0 flex-wrap gap-2 [grid-area:faces]">
        {row.candidates.map(c => <FaceCrop key={c.Id} row={row} candidate={c} actions={actions} />)}
      </div>
      <div className="min-w-0 [grid-area:who] max-lg:max-w-[340px]">
        <WhoField row={row} actions={actions} />
      </div>
      {actions.canEdit && (
        <div className="relative flex items-center justify-end gap-1 [grid-area:acts]">
          <Button variant="outline" size="sm" disabled={!row.person || actions.busy}
            className="bg-card font-semibold shadow-[var(--shadow-sm)] disabled:border-transparent disabled:bg-transparent disabled:font-medium disabled:shadow-none disabled:opacity-100 disabled:text-text-muted"
            onClick={() => actions.onTag(row)}>
            {ft('action_tag', { count: n })}
          </Button>
          <ActionMenu label={ft('row_more', { name })} items={[
            { label: ft('action_cant_identify_all', { count: n }), onSelect: () => actions.onDismiss(row, row.candidates, 'unidentified') },
            { label: ft('action_none_faces', { count: n }), onSelect: () => actions.onDismiss(row, row.candidates, 'not-a-face') },
          ]}
            trigger={<Ellipsis size={18} aria-hidden="true" />}
            triggerClassName="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-hover-surface cursor-pointer focus-ring disabled:opacity-50" />
        </div>
      )}
    </div>
  );
}

/** A row after Tag or set aside: a one-line summary in its place, with Undo. */
export function FaceSettledRow({ row, treeId, canUndo, busy, onUndo }: { row: SettledFaceRow; treeId: number | null; canUndo: boolean; busy: boolean; onUndo: () => void }) {
  const ft = useTranslations('faceTags');
  const n = row.candidates.length;
  return (
    <div data-testid="face-row-settled" role="status"
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 border-b border-border-light px-4 py-3 text-sm text-text-secondary last:border-b-0 lg:grid-cols-[180px_minmax(0,1fr)_auto]">
      <span className="serif truncate text-base font-semibold text-text-muted max-lg:hidden">{row.name}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        {row.candidates.slice(0, 4).map(c => <FaceCropThumb key={c.Id} candidate={c} treeId={treeId} size={40} label={c.MediaTitle || ft('face_card_title')} className="opacity-75" />)}
        <span className="ml-2 min-w-0">
          {row.outcome.kind === 'tagged' ? (
            <>
              <Check size={14} strokeWidth={3} aria-hidden="true" className="mr-1.5 inline text-success" />
              {ft.rich('settled_tagged', { count: n, name: row.outcome.person, b: (c) => <b className="serif font-semibold text-text">{c}</b> })}
            </>
          ) : ft('settled_set_aside', { count: n, reason: ft(row.outcome.reason === 'not-a-face' ? 'reason_not_a_face' : 'reason_unidentified') })}
        </span>
      </span>
      {canUndo && (
        <button type="button" disabled={busy} onClick={onUndo}
          className="rounded-md px-2 py-1.5 text-sm text-link hover:bg-hover-surface cursor-pointer focus-ring disabled:opacity-50">{ft('action_undo')}</button>
      )}
    </div>
  );
}

/** The column heads over the rows (lg only; tablet stacks each row). */
export function FaceRowsHeader() {
  const ft = useTranslations('faceTags');
  return (
    <div aria-hidden="true" className={cx(ROW_GRID, 'hidden min-h-[38px] items-center rounded-t-card border-b border-border bg-card-alt px-4 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted lg:grid')}>
      <span className="[grid-area:name]">{ft('col_named')}</span>
      <span className="[grid-area:faces]">{ft('col_faces')}</span>
      <span className="[grid-area:who]">{ft('col_who')}</span>
      <span className="[grid-area:acts]" />
    </div>
  );
}

/** Recently resolved: what happened to each group, with Undo. */
export function FaceResolvedRow({ name, candidates, treeId, canUndo, busy, onUndo }: {
  name: string; candidates: MediaFaceCandidate[]; treeId: number | null; canUndo: boolean; busy: boolean; onUndo: () => void;
}) {
  const ft = useTranslations('faceTags');
  const dismissed = candidates.find(c => c.Status === 'dismissed');
  const allDismissed = candidates.every(c => c.Status === 'dismissed');
  return (
    <div data-testid="face-row-resolved" className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-border-light px-4 py-3 last:border-b-0">
      <span className="flex gap-1.5">
        {candidates.slice(0, 4).map(c => <FaceCropThumb key={c.Id} candidate={c} treeId={treeId} size={48} label={c.MediaTitle || ft('face_card_title')} />)}
      </span>
      <span className="min-w-0 text-sm">
        {allDismissed && dismissed
          ? ft('resolved_set_aside', { reason: ft(dismissed.DismissReason === 'not-a-face' ? 'reason_not_a_face' : 'reason_unidentified') })
          : <><Check size={14} strokeWidth={3} aria-hidden="true" className="mr-1.5 inline text-success" />{ft('resolved_tagged')}</>}
        <small className="block text-meta text-text-muted">{ft('resolved_named', { name, count: candidates.length })}</small>
      </span>
      {canUndo && <Button variant="outline" size="sm" disabled={busy} onClick={onUndo}>{ft('action_undo')}</Button>}
    </div>
  );
}
