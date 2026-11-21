'use client';

import React, { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { MergeField, MergePreview, MergeSide } from '@/lib/data/types';
import type { PersonResult } from '@/lib/db/schema';
import { getDataClient } from '@/lib/data';
import { formatDateForDisplay } from '@/lib/date-utils';
import { getInitials } from '@/lib/utils/initials';
import { AlertTriangle, Check, Search } from '@/lib/icons';
import Modal from '@/app/components/Modal';
import PersonAvatar from '@/app/components/PersonAvatar';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { Banner, Button, DialogHeader, Lifespan, PersonIdentity, ScrollArea, buttonClass, cx, fieldClass } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import {
  chooseKeep, duplicatesOf, livingValue, mergeRequest, movedCounts, resultNames, sexValue, sideName,
  type MergeChoice, type Side,
} from './model';

/*
 * Merge two people (#28, ADR 0052, locked board https://claude.ai/artifact/3EwsjRedamWFbC9WW5ydCJ):
 * pick the other record ("Merge Anna with…"), then layout A side by side (keep
 * cards, one row per differing field, "Also moves"), then the done screen. A pair
 * that can't be merged shows why instead. A dialog on the desktop, a sheet on the phone.
 */

export interface PersonMergeFlowProps {
  open: boolean;
  onClose: () => void;
  /** The person the merge starts from. */
  person: { Id: number; FirstName: string | null; LastName: string | null };
  /** Skip the picker: the pair is already known (Data checks). */
  otherId?: number | null;
  treeId: number | null;
  /** The merge is saved: the kept record's id. */
  onMerged: (keptId: number) => void;
}

/** A fresh flow each time it opens. */
export function PersonMergeFlow(props: PersonMergeFlowProps) {
  const [opened, setOpened] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) { setWasOpen(props.open); if (props.open) setOpened((n) => n + 1); }
  if (!props.open) return null;
  return <MergeFlowBody key={opened} {...props} />;
}

type Step =
  | { kind: 'pick' }
  | { kind: 'loading'; otherId: number }
  | { kind: 'review'; preview: MergePreview; choice: MergeChoice }
  | { kind: 'done'; keptId: number; kept: string; other: string; alternate: boolean };

function MergeFlowBody({ onClose, person, otherId, treeId, onMerged }: PersonMergeFlowProps) {
  const t = useTranslations('personMerge');
  const isMobile = useIsMobile();
  const { reportError } = useErrorToast();
  const titleId = useId();
  const [step, setStep] = useState<Step>(otherId ? { kind: 'loading', otherId } : { kind: 'pick' });
  const [busy, setBusy] = useState(false);
  const personName = sideName(person) || t('this_person');

  const loadingId = step.kind === 'loading' ? step.otherId : null;
  useEffect(() => {
    if (loadingId == null) return;
    let live = true;
    getDataClient()
      .then((client) => client.people.previewMerge(person.Id, loadingId, treeId))
      .then((preview) => { if (live) setStep({ kind: 'review', preview, choice: chooseKeep('a', preview.differing) }); })
      .catch((e) => { if (live) { reportError(e); setStep({ kind: 'pick' }); } });
    return () => { live = false; };
  }, [loadingId, person.Id, treeId, reportError]);

  const merge = async () => {
    if (step.kind !== 'review' || busy) return;
    const { preview, choice } = step;
    setBusy(true);
    try {
      const client = await getDataClient();
      const req = mergeRequest(preview.a, preview.b, choice);
      await client.people.merge(req, treeId);
      const names = resultNames(preview.a, preview.b, choice);
      setStep({ kind: 'done', keptId: req.keptId, kept: names.kept, other: names.other, alternate: names.other.toLocaleLowerCase() !== names.kept.toLocaleLowerCase() && names.other !== '' });
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    if (step.kind === 'done') onMerged(step.keptId);
    else onClose();
  };

  const title = step.kind === 'pick' ? t('pick_title', { name: personName })
    : step.kind === 'review' && step.preview.blocked ? t('blocked_title')
    : t('title');

  let body: React.ReactNode;
  let footer: React.ReactNode = null;
  let subtitle: React.ReactNode = null;
  if (step.kind === 'pick') {
    subtitle = t('pick_subtitle');
    body = <MergePicker person={person} treeId={treeId} onCancel={onClose} onContinue={(id) => setStep({ kind: 'loading', otherId: id })} />;
  } else if (step.kind === 'loading') {
    body = <p className="m-0 py-10 text-center text-sm text-text-muted" role="status">{t('loading')}</p>;
  } else if (step.kind === 'review' && step.preview.blocked) {
    body = <BlockedBody preview={step.preview} onClose={onClose} />;
  } else if (step.kind === 'review') {
    subtitle = t('subtitle');
    const { preview, choice } = step;
    const away = choice.keep === 'a' ? preview.b : preview.a;
    body = <ReviewBody preview={preview} choice={choice} onChange={(c) => setStep({ ...step, choice: c })} phone={isMobile} />;
    footer = (
      <MergeFooter away={away} phone={isMobile} busy={busy} onCancel={onClose} onMerge={merge} />
    );
  } else {
    body = <DoneBody step={step} titleId={titleId} onDone={finish} />;
  }

  if (isMobile) {
    return (
      <Sheet open onClose={step.kind === 'done' ? finish : onClose} title={title} size="full">
        {subtitle && step.kind === 'pick' && <p className="m-0 mb-3 text-sm text-text-muted">{subtitle}</p>}
        {body}
        {footer}
      </Sheet>
    );
  }

  const wide = step.kind === 'review' && !step.preview.blocked || step.kind === 'loading';
  return (
    <Modal open onClose={step.kind === 'done' ? finish : onClose} size={wide ? 'wide' : 'form'} labelledBy={titleId} disableClose={busy}>
      <div className="flex max-h-[calc(100dvh-64px)] flex-col overflow-hidden rounded-panel border border-border bg-card shadow-xl">
        {step.kind !== 'done' && (
          <DialogHeader
            className={cx('px-8 pt-6', wide ? 'border-b border-border pb-4' : 'pb-2')}
            title={title}
            titleId={titleId}
            subtitle={subtitle && <span className="block max-w-[640px]">{subtitle}</span>}
            onClose={onClose}
            closeDisabled={busy}
          />
        )}
        <ScrollArea className="min-h-0 flex-1">{body}</ScrollArea>
        {footer}
      </div>
    </Modal>
  );
}

// ---- Picker ----------------------------------------------------------------

interface PickRow { person: PersonResult; likely: boolean }

function MergePicker({ person, treeId, onCancel, onContinue }: {
  person: PersonMergeFlowProps['person']; treeId: number | null; onCancel: () => void; onContinue: (id: number) => void;
}) {
  const t = useTranslations('personMerge');
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');
  const [likely, setLikely] = useState<PersonResult[]>([]);
  const [named, setNamed] = useState<PersonResult[]>([]);
  const [found, setFound] = useState<PersonResult[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const surname = person.LastName?.trim() ?? '';

  // Likely duplicates first, then others with the same surname.
  useEffect(() => {
    let live = true;
    (async () => {
      const client = await getDataClient();
      const [groups, sameName] = await Promise.all([
        client.people.listFlagged('duplicates', treeId).catch(() => [] as number[][]),
        surname ? client.people.search(surname, treeId, 20).catch(() => [] as PersonResult[]) : Promise.resolve([] as PersonResult[]),
      ]);
      const ids = duplicatesOf(person.Id, groups).slice(0, 5);
      const dupes = (await Promise.all(ids.map((id) => client.people.get(id, treeId).catch(() => null))))
        .filter((p): p is NonNullable<typeof p> => p != null);
      if (!live) return;
      setLikely(dupes);
      if (dupes.length) setPicked((p) => p ?? dupes[0].Id);
      setNamed(sameName.filter((p) => p.Id !== person.Id && !ids.includes(p.Id) && (p.LastName ?? '').trim().toLocaleLowerCase() === surname.toLocaleLowerCase()));
    })().catch(() => { /* the search box still works */ });
    return () => { live = false; };
  }, [person.Id, surname, treeId]);

  // Typing searches the whole tree.
  const q = query.trim();
  useEffect(() => {
    if (!q) return;
    let live = true;
    const timer = window.setTimeout(() => {
      getDataClient()
        .then((client) => client.people.search(q, treeId, 20))
        .then((rows) => { if (live) setFound(rows.filter((p) => p.Id !== person.Id)); })
        .catch(() => { if (live) setFound([]); });
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [q, treeId, person.Id]);

  const sections: { label: string; rows: PickRow[] }[] = q
    ? [{ label: t('pick_matches'), rows: (found ?? []).map((p) => ({ person: p, likely: false })) }]
    : [
      ...(likely.length ? [{ label: t('pick_likely'), rows: likely.map((p) => ({ person: p, likely: true })) }] : []),
      ...(named.length ? [{ label: t('pick_same_surname', { surname }), rows: named.map((p) => ({ person: p, likely: false })) }] : []),
    ];
  const empty = sections.every((s) => s.rows.length === 0);

  return (
    <>
      <div className={cx(!isMobile && 'px-8 pt-2 pb-2')}>
        <label className="relative block">
          <span className="sr-only">{t('pick_search')}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            autoComplete="off"
            placeholder={t('pick_search')}
            onChange={(e) => setQuery(e.target.value)}
            className={cx(fieldClass(), 'w-full pl-9', isMobile ? 'min-h-11' : 'min-h-10')}
          />
        </label>
        <div role="radiogroup" aria-label={t('pick_group')} className="mt-3 grid gap-1">
          {sections.map((s) => s.rows.length > 0 && (
            <React.Fragment key={s.label}>
              <h3 className="eyebrow m-0 mt-2 mb-1">{s.label}</h3>
              {s.rows.map(({ person: p, likely: isLikely }) => (
                <button
                  key={p.Id}
                  type="button"
                  role="radio"
                  aria-checked={picked === p.Id}
                  onClick={() => setPicked(p.Id)}
                  onDoubleClick={() => onContinue(p.Id)}
                  className={cx('merge-choice focus-ring flex w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-left', picked !== p.Id && 'border-transparent')}
                >
                  <PersonIdentity
                    as="span"
                    name={[p.EffectiveFirstName ?? p.FirstName, p.LastName].filter(Boolean).join(' ') || t('unknown_name')}
                    initials={getInitials(p.FirstName, p.LastName)}
                    mediaId={p.PrimaryMediaId}
                    focalX={p.FocalX}
                    focalY={p.FocalY}
                    focalRadius={p.FocalRadius}
                    treeId={treeId}
                    lifespan={<Lifespan birth={p.BirthDate} death={p.DeathDate} />}
                    detail={p.BirthPlace?.split(',')[0]?.trim() || null}
                  />
                  {isLikely && !isMobile && <span className="shrink-0 text-meta text-text-muted">{t('pick_likely_tag')}</span>}
                </button>
              ))}
            </React.Fragment>
          ))}
          {empty && (
            <p className="m-0 py-6 text-center text-sm text-text-muted">{q && found != null ? t('pick_none_found') : q ? t('loading') : t('pick_hint')}</p>
          )}
        </div>
      </div>
      <div className={cx('flex items-center justify-end gap-2', isMobile ? 'sticky bottom-0 bg-card pt-3 pb-2' : 'mt-3 border-t border-border px-8 py-4')}>
        {!isMobile && <Button variant="outline" onClick={onCancel}>{t('cancel')}</Button>}
        <Button variant="primary" size={isMobile ? 'lg' : 'md'} block={isMobile} disabled={picked == null} onClick={() => { if (picked != null) onContinue(picked); }}>
          {t('continue')}
        </Button>
      </div>
    </>
  );
}

// ---- Review ----------------------------------------------------------------

function useMergeFormat() {
  const t = useTranslations('personMerge');
  const { language } = useLanguage();
  const words = useDateQualifierWords();
  const date = (d: string | null) => (d ? formatDateForDisplay(d, language, words) : '');
  const added = (side: MergeSide) => {
    const when = side.CreatedAt ? new Date(side.CreatedAt) : null;
    const day = when && !isNaN(when.getTime()) ? when.toLocaleDateString(language, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    if (side.Imported) return day ? t('added_import_on', { date: day }) : t('added_import');
    return day ? t('added_hand_on', { date: day }) : t('added_hand');
  };
  return { date, added };
}

interface FieldValue { main: string; sub?: string; sources?: number }

function useFieldValue() {
  const t = useTranslations('personMerge');
  const { date } = useMergeFormat();
  return (field: MergeField, s: MergeSide): FieldValue => {
    switch (field) {
      case 'name': {
        const parts = [
          s.FirstName?.trim() ? t('name_given', { given: s.FirstName.trim() }) : null,
          s.LastName?.trim() ? t('name_surname', { surname: s.LastName.trim() }) : null,
        ].filter(Boolean);
        return { main: sideName(s) || t('unknown_name'), sub: parts.join(' · ') };
      }
      case 'sex': return { main: t(`sex_${sexValue(s)}`) };
      case 'living': return { main: t(`living_${livingValue(s)}`) };
      case 'birth': return { main: date(s.BirthDate) || t('no_date'), sub: s.BirthPlace ?? undefined, sources: s.BirthSources };
      case 'death': return { main: date(s.DeathDate) || t('no_date'), sub: s.DeathPlace ?? undefined, sources: s.DeathSources };
    }
  };
}

const FIELD_HINT: Partial<Record<MergeField, string>> = { name: 'hint_name', birth: 'hint_sources', death: 'hint_sources' };

function ReviewBody({ preview, choice, onChange, phone }: {
  preview: MergePreview; choice: MergeChoice; onChange: (c: MergeChoice) => void; phone: boolean;
}) {
  const t = useTranslations('personMerge');
  const valueOf = useFieldValue();
  const { added } = useMergeFormat();
  const ids = useId();
  const matching = 5 - preview.differing.length;
  const sides: Side[] = ['a', 'b'];
  const sideOf = (s: Side) => (s === 'a' ? preview.a : preview.b);
  const keepLabelId = `${ids}-keep`;

  const keepCard = (s: Side) => {
    const p = sideOf(s);
    const on = choice.keep === s;
    const years = <Lifespan birth={p.BirthDate} death={p.DeathDate} status={livingValue(p) === 'deceased' ? 'deceased' : undefined} />;
    if (phone) {
      return (
        <button key={s} type="button" role="radio" aria-checked={on} onClick={() => onChange(chooseKeep(s, preview.differing))}
          className="merge-choice focus-ring flex w-full cursor-pointer items-start gap-3 rounded-[10px] px-3.5 py-3 text-left">
          <span className="merge-dot mt-0.5" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-text">{sideName(p) || t('unknown_name')}</span>
            <span className="block text-meta text-text-muted">{years}{' · '}{added(p)}</span>
          </span>
        </button>
      );
    }
    return (
      <button key={s} type="button" role="radio" aria-checked={on} onClick={() => onChange(chooseKeep(s, preview.differing))}
        className="merge-choice focus-ring flex w-full cursor-pointer flex-col gap-2.5 rounded-[12px] p-4 text-left">
        <span className="flex w-full items-center gap-3">
          <PersonAvatar as="span" name={sideName(p)} initials={getInitials(p.FirstName, p.LastName)} size={44} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="serif truncate text-lg text-text">{sideName(p) || t('unknown_name')}</span>
            <span className="text-sm text-text-muted">{years}</span>
          </span>
          <span className={cx('inline-flex h-[22px] shrink-0 items-center rounded-full px-2.5 text-meta font-semibold', on ? 'bg-primary text-white' : 'bg-surface-2 text-text-secondary')}>
            {on ? t('tag_keep') : t('tag_away')}
          </span>
        </span>
        <span className="text-meta text-text-muted">{added(p)}</span>
      </button>
    );
  };

  const option = (field: MergeField, s: Side, rowId: string) => {
    const v = valueOf(field, sideOf(s));
    const on = (choice.picks[field] ?? choice.keep) === s;
    return (
      <button key={s} type="button" role="radio" aria-checked={on} aria-describedby={rowId}
        onClick={() => onChange({ ...choice, picks: { ...choice.picks, [field]: s } })}
        className={cx('merge-choice focus-ring flex w-full cursor-pointer items-start gap-3 rounded-[10px] px-3.5 py-3 text-left', !phone && 'min-h-14')}>
        <span className="merge-dot mt-px" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium text-text">{v.main}</span>
          {v.sub && !phone && <span className="text-meta text-text-muted">{v.sub}</span>}
          {v.sub && phone && field !== 'name' && <span className="text-meta text-text-muted">{v.sub}</span>}
        </span>
        {v.sources != null && v.sources > 0 && (
          <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-surface-2 px-2 text-xs font-medium text-text-secondary">{t('sources', { count: v.sources })}</span>
        )}
      </button>
    );
  };

  const rows = preview.differing.map((field) => {
    const rowId = `${ids}-${field}`;
    const hint = FIELD_HINT[field];
    if (phone) {
      return (
        <div key={field} role="radiogroup" aria-labelledby={rowId} className="grid gap-2">
          <h4 id={rowId} className="m-0 text-sm font-semibold text-text">{t(`field_${field}`)}</h4>
          {sides.map((s) => option(field, s, rowId))}
          {hint && <p className="m-0 text-meta text-text-muted">{t(hint)}</p>}
        </div>
      );
    }
    return (
      <div key={field} role="radiogroup" aria-labelledby={rowId} className="grid grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] items-stretch gap-x-4">
        <div className="flex flex-col justify-center gap-0.5 pl-0.5">
          <span id={rowId} className="font-medium text-text">{t(`field_${field}`)}</span>
          {hint && <span className="text-meta leading-snug text-text-muted">{t(hint)}</span>}
        </div>
        {sides.map((s) => option(field, s, rowId))}
      </div>
    );
  });

  const differHeader = (
    <div className={cx('flex items-baseline justify-between gap-3', phone ? 'border-t border-border pt-4' : 'col-span-3 mt-2.5 border-t border-border pt-4')}>
      <h3 className={phone ? 'eyebrow m-0' : 'm-0 text-md font-semibold text-text'}>{t('fields_differ')}</h3>
      {matching > 0 && preview.differing.length > 0 && (
        <span className="text-meta text-text-muted">{phone ? t('fields_match_short', { count: matching }) : t('fields_match', { count: matching })}</span>
      )}
    </div>
  );
  const noDiff = preview.differing.length === 0 && <p className="m-0 text-sm text-text-muted">{t('fields_all_match')}</p>;

  if (phone) {
    return (
      <div className="grid gap-4 pb-4">
        <div role="radiogroup" aria-labelledby={keepLabelId} className="grid gap-2">
          <h3 id={keepLabelId} className="eyebrow m-0">{t('keep')}</h3>
          {sides.map(keepCard)}
        </div>
        {differHeader}
        {noDiff}
        {rows}
      </div>
    );
  }
  return (
    <>
      <div className="grid grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] items-stretch gap-x-4 gap-y-2.5 px-8 pt-5">
        <div className="flex flex-col justify-center"><span id={keepLabelId} className="eyebrow">{t('keep')}</span></div>
        <div role="radiogroup" aria-labelledby={keepLabelId} className="col-span-2 grid grid-cols-2 gap-x-4">
          {sides.map(keepCard)}
        </div>
        {differHeader}
      </div>
      <div className="flex flex-col gap-2.5 px-8 pt-2.5 pb-2">
        {noDiff}
        {rows}
      </div>
    </>
  );
}

function MergeFooter({ away, phone, busy, onCancel, onMerge }: { away: MergeSide; phone: boolean; busy: boolean; onCancel: () => void; onMerge: () => void }) {
  const t = useTranslations('personMerge');
  const moves = movedCounts(away).map((m) => t(`moves_${m.key}`, { count: m.count }));
  const line = moves.length ? t('also_moves', { list: moves.join(', ') }) : t('moves_nothing');
  if (phone) {
    return (
      <div className="sticky bottom-0 -mx-4 grid gap-2 border-t border-border bg-card px-4 pt-3 pb-2">
        <p className="m-0 text-meta text-text-muted">{line}</p>
        <p className="m-0 text-meta text-text-muted">{t('revert_note')}</p>
        <Button variant="primary" size="lg" block disabled={busy} onClick={onMerge}>{busy ? t('merging') : t('merge')}</Button>
      </div>
    );
  }
  return (
    <div className="mt-3.5 flex items-center justify-between gap-6 border-t border-border px-8 pt-4 pb-6">
      <div className="flex max-w-[600px] flex-col gap-0.5 text-sm text-text-muted">
        <span>{line}</span>
        <span>{t('revert_note')}</span>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
        <Button variant="primary" onClick={onMerge} disabled={busy}>{busy ? t('merging') : t('merge')}</Button>
      </div>
    </div>
  );
}

// ---- Blocked and done ------------------------------------------------------

function BlockedBody({ preview, onClose }: { preview: MergePreview; onClose: () => void }) {
  const t = useTranslations('personMerge');
  const isMobile = useIsMobile();
  const block = preview.blocked!;
  const a = sideName(preview.a) || t('unknown_name');
  const b = sideName(preview.b) || t('unknown_name');
  const card = (s: MergeSide, end: boolean) => (
    <span className={cx('flex min-w-0 items-center gap-3', end && 'flex-row-reverse text-right')}>
      <PersonAvatar as="span" name={sideName(s)} initials={getInitials(s.FirstName, s.LastName)} size={40} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-text">{sideName(s) || t('unknown_name')}</span>
        <span className="text-meta text-text-muted"><Lifespan birth={s.BirthDate} death={s.DeathDate} status={livingValue(s) === 'deceased' ? 'deceased' : undefined} /></span>
      </span>
    </span>
  );
  return (
    <div className={cx('grid gap-4', !isMobile && 'px-8 pt-2 pb-6')}>
      <Banner tone="warning" icon={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}>
        {t(block.reason === 'partners' ? 'blocked_partners' : 'blocked_parent', { a, b })}
      </Banner>
      <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-card-alt p-4">
        {card(preview.a, false)}
        <span className="shrink-0 text-sm text-text-muted">{t(block.reason === 'partners' ? 'blocked_link_partners' : 'blocked_link_parent')}</span>
        {card(preview.b, true)}
      </div>
      <p className="m-0 text-sm text-text-secondary">{t(block.reason === 'partners' ? 'blocked_help_partners' : 'blocked_help_parent')}</p>
      <div className={cx('flex gap-2', isMobile ? 'flex-col-reverse' : 'justify-end')}>
        <Button variant="outline" size={isMobile ? 'lg' : 'md'} onClick={onClose}>{t('close')}</Button>
        <Link href={`/families/view?id=${block.familyId}`} className={buttonClass({ variant: 'primary', size: isMobile ? 'lg' : 'md' })}>{t('open_family')}</Link>
      </div>
    </div>
  );
}

function DoneBody({ step, titleId, onDone }: { step: Extract<Step, { kind: 'done' }>; titleId: string; onDone: () => void }) {
  const t = useTranslations('personMerge');
  const isMobile = useIsMobile();
  return (
    <div className={cx('flex flex-col items-center gap-3.5 text-center', isMobile ? 'py-8' : 'px-12 pt-12 pb-10')}>
      <span className="flex h-13 w-13 items-center justify-center rounded-full bg-success-bg text-success" aria-hidden>
        <Check className="h-6 w-6" />
      </span>
      <h2 id={titleId} className="title-dialog m-0">{t('done_title', { other: step.other, kept: step.kept })}</h2>
      <p className="m-0 max-w-[560px] text-sm text-text-muted">
        {t('done_body', { kept: step.kept })}
        {step.alternate && <> {t('done_alternate', { name: step.other })}</>}
        {' '}{t('done_revert')}
      </p>
      <div className={cx('mt-2.5 flex gap-2', isMobile && 'w-full flex-col-reverse')}>
        <Link href="/audit" className={buttonClass({ variant: 'outline', size: isMobile ? 'lg' : 'md' })}>{t('open_audit')}</Link>
        <Button variant="primary" size={isMobile ? 'lg' : 'md'} onClick={onDone}>{t('done')}</Button>
      </div>
    </div>
  );
}
