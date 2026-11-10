'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronRight, CircleHelp, ImageIcon, ScanFace, Split } from '@/lib/icons';
import { CopperPill, EmptyState, Lifespan, MobileRow, SegmentedControl, cx } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import PersonAvatar from '@/app/components/PersonAvatar';
import { PersonPickerSheet } from '@/app/components/PersonPickerSheet';
import type { FaceGroup } from '@/lib/data/types';
import type { MediaFaceCandidate } from '@/lib/db/schema';
import type { FacePersonRef } from '@/lib/db/queries/media-faces';
import { initialsFromName } from '@/lib/utils/initials';
import { FaceCropThumb, FacePhotoWithBox } from './FaceCropThumb';
import { faceStateLabel, type FaceRowActions } from './FaceDecisionRows';
import { faceRefFromResult, fitsPhoto, photoYear, resultFromFaceRef, sharedNameNote, type FaceRow } from './faceRows';
import type { SettledEntry } from './FacesPanel';

type Item = { row: FaceRow } | { settled: SettledEntry };

/**
 * The faces queue on a phone (#1156, replacing #1126's): Waiting / Recently resolved
 * under the header, then one full-width block per name: name and face count, the
 * coloured state, a strip of 68px crops with their year, the person row (radio rows
 * for a shared name), then Can't identify and a neutral Tag pill. A face opens a sheet
 * with its whole photo. Confirm all is the copper pill and skips shared names.
 */
export function MobileFacesQueue({
  items, groups, pendingTotal, resolvedView, onView, loading, error, actions, confirmAllCount, bulkBusy, onConfirmAll, onUndo,
}: {
  items: Item[];
  /** Resolved view: the server's resolved groups. */
  groups: FaceGroup[];
  pendingTotal: number;
  resolvedView: boolean;
  onView: (resolved: boolean) => void;
  loading: boolean;
  error: string | null;
  actions: FaceRowActions;
  confirmAllCount: number;
  bulkBusy: boolean;
  onConfirmAll: () => void;
  onUndo: (ids: number[]) => void;
}) {
  const ft = useTranslations('faceTags');
  const tm = useTranslations('mobileFaces');
  const tc = useTranslations('common');
  const [face, setFace] = useState<{ row: FaceRow; candidate: MediaFaceCandidate } | null>(null);
  const [pick, setPick] = useState<FaceRow | null>(null);
  const empty = resolvedView ? groups.length === 0 : items.length === 0;
  const pickSuggested = pick
    ? (pick.sharedBy.length > 0 ? pick.sharedBy : pick.group.ambiguousCandidates.length > 0 ? pick.group.ambiguousCandidates
      : pick.group.suggestedPerson ? [pick.group.suggestedPerson] : []).filter(p => p.id !== pick.person?.id)
    : [];

  return (
    <div data-testid="faces-panel" className="md:hidden">
      <div className="sticky top-0 z-[3] border-b border-border bg-surface px-4 py-3">
        <SegmentedControl aria-label={ft('filter_label')} fullWidth value={resolvedView ? 'resolved' : 'pending'} onChange={(v) => onView(v === 'resolved')}
          options={[
            { v: 'pending', l: pendingTotal > 0 ? tm('waiting_n', { count: pendingTotal }) : ft('filter_pending') },
            { v: 'resolved', l: ft('filter_resolved') },
          ]} />
      </div>
      {error && <p role="alert" className="m-0 mx-4 mt-3 rounded-lg px-3.5 py-2.5 text-sm bg-error-bg text-error">{ft('load_failed')}</p>}
      {!error && empty ? (
        <EmptyState variant="empty" title={resolvedView ? ft('queue_resolved_title') : ft('queue_empty_title')}
          message={ft(resolvedView ? 'queue_resolved_empty_body' : 'queue_empty_body')} />
      ) : (
        <div className="transition-opacity" style={{ opacity: loading ? 0.6 : 1 }} aria-busy={loading}>
          {resolvedView ? groups.map((g, i) => (
            <Settled key={g.groupKey} first={i === 0} name={g.sourceName ?? tc('unknown')} candidates={g.candidates} treeId={actions.treeId}
              text={g.candidates.every(c => c.Status === 'dismissed') ? ft('resolved_set_aside', { reason: reasonLabel(ft, g.candidates[0]?.DismissReason) }) : ft('resolved_tagged')}
              tagged={!g.candidates.every(c => c.Status === 'dismissed')}
              canUndo={actions.canEdit} busy={actions.busy} onUndo={() => onUndo(g.candidates.map(c => c.Id))} />
          )) : (
            <>
              <p className="m-0 px-4 pt-3 pb-0.5 text-meta leading-snug text-text-muted">{ft('queue_banner')}</p>
              <ul className="m-0 list-none p-0">
                {items.map((item, i) => 'row' in item ? (
                  <Block key={item.row.key} row={item.row} first={i === 0} actions={actions}
                    onFace={(c) => setFace({ row: item.row, candidate: c })} onPick={() => setPick(item.row)} />
                ) : (
                  <li key={item.settled.key}>
                    <Settled first={i === 0} name={item.settled.name} candidates={item.settled.candidates} treeId={actions.treeId}
                      text={item.settled.outcome.kind === 'tagged'
                        ? ft.rich('settled_tagged', { count: item.settled.candidates.length, name: item.settled.outcome.person, b: (c) => <b className="serif font-semibold text-text">{c}</b> })
                        : ft('settled_set_aside', { count: item.settled.candidates.length, reason: reasonLabel(ft, item.settled.outcome.reason) })}
                      tagged={item.settled.outcome.kind === 'tagged'}
                      canUndo={actions.canEdit} busy={actions.busy} onUndo={() => onUndo(item.settled.candidates.map(c => c.Id))} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <div className="h-24" aria-hidden="true" />

      {actions.canEdit && !resolvedView && confirmAllCount > 0 && (
        <CopperPill floating icon={<Check aria-hidden="true" />} disabled={bulkBusy} onClick={onConfirmAll}>
          {tm('confirm_all', { count: confirmAllCount })}
        </CopperPill>
      )}

      <Sheet open={face != null} onClose={() => setFace(null)} title={tm('this_face')}>
        {face && (() => {
          const { row, candidate: c } = face;
          const year = photoYear(c);
          const notWho = row.person?.name ?? (row.candidates.length > 1 ? null : undefined);
          const close = (then: () => void) => { setFace(null); then(); };
          return (
            <div className="-mx-4 -mt-3">
              <div className="px-4 pt-3.5 pb-1.5"><FacePhotoWithBox candidate={c} treeId={actions.treeId} width={720} /></div>
              <p className="m-0 px-4 pb-2 text-sm text-text">
                {c.MediaTitle || ft('face_card_title')}
                <small className="block text-meta text-text-muted">
                  {[year, row.group.sourceName ? tm('named_in_photo', { name: row.group.sourceName }) : null].filter(Boolean).join(' · ')}
                </small>
              </p>
              {actions.canEdit && (
                <>
                  {notWho !== undefined && (
                    <MobileRow divided icon={<Split aria-hidden="true" />} disabled={actions.busy}
                      label={notWho ? ft('action_not_person', { name: notWho }) : ft('action_not_same')} sub={tm('own_block')}
                      onClick={() => close(() => actions.onSplitNot(row, c))} />
                  )}
                  <MobileRow divided icon={<ScanFace aria-hidden="true" />} label={ft('action_not_a_face')} disabled={actions.busy}
                    onClick={() => close(() => actions.onDismiss(row, [c], 'not-a-face'))} />
                  <MobileRow divided icon={<CircleHelp aria-hidden="true" />} label={ft('action_cant_identify_one')} disabled={actions.busy}
                    onClick={() => close(() => actions.onDismiss(row, [c], 'unidentified'))} />
                </>
              )}
              <MobileRow divided icon={<ImageIcon aria-hidden="true" />} label={tm('open_photo')} sub={tm('open_photo_hint')} end="leave"
                onClick={() => close(() => actions.onOpenPhoto(c))} />
            </div>
          );
        })()}
      </Sheet>

      {/* Picking fills the block; Tag confirms with that person (#1156). */}
      <PersonPickerSheet open={pick != null} onClose={() => setPick(null)} title={tm('who_is_it')} treeId={actions.treeId}
        suggested={pickSuggested.length > 0 ? { label: ft('picker_suggested'), people: pickSuggested.map(resultFromFaceRef) } : undefined}
        onPick={([p]) => {
          const target = pick;
          setPick(null);
          if (target && p?.kind === 'existing') actions.onPick(target, faceRefFromResult(p.person));
        }} />
    </div>
  );
}

function reasonLabel(ft: ReturnType<typeof useTranslations>, reason: string | null | undefined): string {
  return ft(reason === 'not-a-face' ? 'reason_not_a_face' : 'reason_unidentified');
}

function PersonRow({ person, treeId, onClick, disabled }: { person: FacePersonRef; treeId: number | null; onClick?: () => void; disabled: boolean }) {
  const body = (
    <>
      <PersonAvatar as="span" size={32} name={person.name} initials={initialsFromName(person.name)} sex={person.sex} treeId={treeId}
        mediaId={person.mediaId ?? undefined} focalX={person.focalX ?? undefined} focalY={person.focalY ?? undefined} focalRadius={person.focalRadius ?? undefined} />
      <span className="grid min-w-0 flex-1">
        <span className="serif truncate text-md font-semibold">{person.name}</span>
        {(person.birthYear || person.deathYear) && <small className="text-meta text-text-muted"><Lifespan birth={person.birthYear} death={person.deathYear} preformatted /></small>}
      </span>
      {onClick && <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-text-muted" />}
    </>
  );
  const cls = 'flex w-full min-h-[52px] items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left';
  return onClick
    ? <button type="button" onClick={onClick} disabled={disabled} className={cx(cls, 'cursor-pointer focus-ring disabled:opacity-60')}>{body}</button>
    : <div className={cls}>{body}</div>;
}

function Block({ row, first, actions, onFace, onPick }: {
  row: FaceRow; first: boolean; actions: FaceRowActions; onFace: (c: MediaFaceCandidate) => void; onPick: () => void;
}) {
  const ft = useTranslations('faceTags');
  const tm = useTranslations('mobileFaces');
  const tc = useTranslations('common');
  const name = row.group.sourceName ?? tc('unknown');
  const n = row.candidates.length;
  const shared = row.sharedBy.length > 0 && !row.person;
  const note = shared ? sharedNameNote(row) : null;
  const year = row.perFace ? photoYear(row.candidates[0]) : null;
  const tone = row.kind === 'exact' || row.kind === 'variant' ? 'text-success' : row.kind === 'chosen' ? 'text-text-muted' : 'text-warning-text';
  const link = 'relative min-h-11 py-2 text-sm font-medium text-link cursor-pointer rounded focus-ring disabled:opacity-40';

  return (
    <li className={cx('pt-3.5 pb-1.5', !first && 'border-t border-border')} data-testid="face-block">
      <div className="flex items-baseline gap-2 px-4">
        <h3 className="serif m-0 min-w-0 flex-1 truncate text-lg font-semibold">{name}</h3>
        <span className="shrink-0 text-meta tabular-nums text-text-muted">{ft('group_faces_count', { count: n })}</span>
      </div>
      <p className={cx('m-0 px-4 pt-px text-meta font-medium', tone)}>
        {faceStateLabel(ft, row.kind, row.sharedBy.length || row.group.ambiguousPersonCount || 0)}
        {row.perFace && <span className="font-normal text-text-muted"> · {tm('face_n_of', { index: row.perFace.index, of: row.perFace.of })}</span>}
        {row.splitFrom && <span className="font-normal text-text-muted"> · {tm('not_name', { name: row.splitFrom })}</span>}
      </p>
      <div role="group" aria-label={ft('col_faces')} className="hscroll-strip flex gap-2 overflow-x-auto px-4 pt-2.5 pb-1">
        {row.candidates.map((c) => {
          const y = photoYear(c);
          return (
            <span key={c.Id} className="grid w-[68px] shrink-0 gap-[3px]">
              <FaceCropThumb candidate={c} treeId={actions.treeId} size={68} className="rounded-[10px]"
                label={ft('show_photo', { title: c.MediaTitle || ft('face_card_title') })} onClick={() => onFace(c)} />
              <span className="text-xs tabular-nums text-text-muted">{y ?? ''}</span>
            </span>
          );
        })}
      </div>
      <div className="grid gap-1.5 px-4 pt-1.5">
        {shared ? (
          <>
            {note && (
              <p className="m-0 my-0.5 border-l-[3px] border-evidence py-px pl-2.5 text-meta leading-snug text-text-secondary">
                {note.kind === 'span'
                  ? ft('note_span', { from: note.from, to: note.to, name: note.name, born: note.born })
                  : ft.rich('note_likely', { year: note.year, out: note.out, likely: note.likely, b: (c) => <b className="font-semibold text-text">{c}</b> })}
              </p>
            )}
            <div role="radiogroup" aria-label={ft('ambiguous_candidates_label')} className="grid gap-1.5">
              {row.sharedBy.map(p => {
                const fits = fitsPhoto(p, year);
                return (
                  <button key={p.id} type="button" role="radio" aria-checked={false} disabled={!actions.canEdit || actions.busy || !fits}
                    onClick={() => actions.onPick(row, p)}
                    className={cx('flex w-full min-h-[52px] items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-left focus-ring',
                      fits ? 'bg-card enabled:cursor-pointer' : 'border-dashed bg-transparent opacity-55')}>
                    <span aria-hidden="true" className={cx('h-5 w-5 shrink-0 rounded-full border-2 border-text-muted', !fits && 'border-dashed')} />
                    <span className="grid min-w-0 flex-1">
                      <span className="serif truncate text-md font-semibold">{p.name}</span>
                      {(p.birthYear || p.deathYear) && <small className="text-meta text-text-muted"><Lifespan birth={p.birthYear} death={p.deathYear} preformatted /></small>}
                    </span>
                  </button>
                );
              })}
            </div>
            {actions.canEdit && (
              <div className="flex gap-[18px]">
                <button type="button" disabled={actions.busy} onClick={onPick} className={link}>{tm('someone_else')}</button>
                {!row.perFace && n > 1 && (
                  <button type="button" disabled={actions.busy} onClick={() => actions.onEachFace(row)}
                    className={cx(link, note && 'font-bold underline underline-offset-[3px]')}>{ft('action_each_face')}</button>
                )}
              </div>
            )}
          </>
        ) : row.person ? (
          <PersonRow person={row.person} treeId={actions.treeId} disabled={actions.busy} onClick={actions.canEdit ? onPick : undefined} />
        ) : actions.canEdit ? (
          <button type="button" onClick={onPick} disabled={actions.busy}
            className="flex w-full min-h-[52px] items-center gap-2.5 rounded-lg border border-dashed border-border px-3 py-2 text-left text-md text-text-muted cursor-pointer focus-ring">
            <span className="flex-1">{tm('choose_person')}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {actions.canEdit && (
        <div className="flex items-center justify-end gap-[18px] px-4 pt-2 pb-1.5">
          <button type="button" disabled={actions.busy} onClick={() => actions.onDismiss(row, row.candidates, 'unidentified')}
            className="min-h-11 py-2.5 text-sm font-medium text-text-muted cursor-pointer rounded focus-ring disabled:opacity-40">{ft('action_cant_identify')}</button>
          <button type="button" disabled={!row.person || actions.busy} onClick={() => actions.onTag(row)}
            className="min-h-[38px] rounded-full border border-border bg-card px-[18px] text-sm font-semibold text-text shadow-[var(--shadow-sm)] cursor-pointer focus-ring disabled:cursor-default disabled:bg-transparent disabled:font-medium disabled:text-text-muted disabled:shadow-none">
            {ft('action_tag', { count: n })}
          </button>
        </div>
      )}
    </li>
  );
}

/** A tagged or set-aside block, shrunk to one line with Undo; also the Recently resolved rows. */
function Settled({ first, name, candidates, treeId, text, tagged = false, canUndo, busy, onUndo }: {
  first: boolean; name: string; candidates: MediaFaceCandidate[]; treeId: number | null; text: React.ReactNode; tagged?: boolean;
  canUndo: boolean; busy: boolean; onUndo: () => void;
}) {
  const tm = useTranslations('mobileFaces');
  const ft = useTranslations('faceTags');
  return (
    <div role="status" data-testid="face-block-settled" className={cx('flex items-center gap-2.5 px-4 py-2.5 text-sm text-text-secondary', !first && 'border-t border-border')}>
      {candidates.slice(0, 2).map(c => <FaceCropThumb key={c.Id} candidate={c} treeId={treeId} size={36} className="rounded-lg opacity-80" label={c.MediaTitle || ft('face_card_title')} />)}
      <span className="min-w-0 flex-1">
        {tagged && <Check size={14} strokeWidth={3} aria-hidden="true" className="mr-1 inline text-success" />}
        {text}
        <small className="block text-meta text-text-muted">{tm('named_in_photo', { name })}</small>
      </span>
      {canUndo && (
        <button type="button" disabled={busy} onClick={onUndo} className="min-h-11 py-2.5 text-sm font-semibold text-link cursor-pointer rounded focus-ring disabled:opacity-40">{ft('action_undo')}</button>
      )}
    </div>
  );
}
