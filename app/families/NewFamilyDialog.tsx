'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Family, FamilyType, PersonResult } from '@/lib/db/schema';
import type { HierarchyLevel } from '@/lib/geocode/photon';
import type { ChildRelationships } from '@/lib/child-relationship';
import { getDataClient } from '@/lib/data';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { formatYearOrEmpty } from '@/lib/date-utils';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import AttachSourceSidebar, { type PendingCitation } from '@/app/components/AttachSourceSidebar';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import DateInput from '@/app/components/DateInput';
import LocationField from '@/app/components/LocationField';
import type { PickedPerson } from '@/app/components/PersonPickerSheet';
import { useCachedResource } from '@/app/components/useCachedResource';
import { useErrorToast } from '@/app/components/useErrorToast';
import { usePlaceResolutionFlush } from '@/app/components/usePlaceResolutionFlush';
import {
  ActionLink, Button, EmptySlot, FieldColumn, FieldColumns, FilterChip, FormBlock, FormDialog, Lifespan, ParentRelationshipSelects,
  PersonFinder, PersonIdentity, RecordBlock, SegmentedControl, SelectField, SuggestionRow, WarningLine, citeClass, fieldClass,
  showChangeToast, showErrorToast,
} from '@/app/components/ui';
import { useTree } from '@/app/contexts/TreeContext';
import { peopleListKey } from '@/app/people/peopleListKey';
import { partnerShortName } from './view/derive';
import type { PartnerPerson } from './view/useFamilyDetail';
import { coupleName } from './view/mobile/model';
import { ftypeKey } from './view/mobile/panes';
import {
  childWindow, existingId, faceOf, firstDeath, inBirthOrder, likelyChildren, partnerSuggestions, sharedFamily, slotLinks, stage, takenIds,
  type PoolPerson, type Staged, type StagedChild, type StagedFace,
} from './new/mobile/model';
import { saveNewFamily, type CiteFor, type EndReason } from './new/saveNewFamily';

/*
 * New family on desktop (#52): the locked quick-add dialog over the Families list.
 * Two partner slots side by side, Type and Status, Married | Ended, and children with
 * a relationship select per partner (ADR 0027). The finders are popovers over the
 * dialog. Nothing is written until Save, which writes what the phone sheet writes
 * (`saveNewFamily`) and opens the new family.
 */

const FAMILY_TYPES: FamilyType[] = ['Marriage', 'Civil union', 'Common-law', 'Other'];
type How = 'death' | EndReason;
const HOWS: How[] = ['death', 'Divorce', 'Annulment', 'Separation'];
const isReason = (h: How | null): h is EndReason => h != null && h !== 'death';

export function NewFamilyDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (familyId: number) => void }) {
  // A fresh form each time it opens.
  const [opened, setOpened] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpened((n) => n + 1);
  }
  if (!open) return null;
  return <Form key={opened} onClose={onClose} onCreated={onCreated} />;
}

function Form({ onClose, onCreated }: { onClose: () => void; onCreated: (familyId: number) => void }) {
  const t = useTranslations('newFamilyDialog');
  const tn = useTranslations('newFamilyPhone');
  const tf = useTranslations('mobileFamily');
  const tp = useTranslations('familyPhone');
  const te = useTranslations('mobileEvents');
  const tef = useTranslations('editFamily');
  const tpk = useTranslations('personPicker');
  const tc = useTranslations('common');
  const ids = useId();
  const { activeTreeId: treeId } = useTree();
  const { reportError } = useErrorToast();
  const flushPlace = usePlaceResolutionFlush(treeId);

  const [partners, setPartners] = useState<Staged[]>([]);
  const [children, setChildren] = useState<StagedChild[]>([]);
  const [type, setType] = useState<FamilyType>('Marriage');
  const [date, setDate] = useState('');
  const [place, setPlace] = useState('');
  const [placeRes, setPlaceRes] = useState<HierarchyLevel[] | null | undefined>(undefined);
  const [placeId, setPlaceId] = useState<number | null>(null);
  const [endedChosen, setEndedChosen] = useState(false);
  const [how, setHow] = useState<How | null>(null);
  const [endDate, setEndDate] = useState('');
  const [endPlace, setEndPlace] = useState('');
  const [endPlaceRes, setEndPlaceRes] = useState<HierarchyLevel[] | null | undefined>(undefined);
  const [endPlaceId, setEndPlaceId] = useState<number | null>(null);
  const [pending, setPending] = useState<(PendingCitation & { for: CiteFor })[]>([]);
  const [citing, setCiting] = useState<CiteFor | null>(null);
  const [askClear, setAskClear] = useState(false);
  const [saving, setSaving] = useState(false);

  // The tree's people, the people page's cached copy: suggestions, partnership counts, deaths.
  const poolRes = useCachedResource(peopleListKey(treeId), async () => {
    const client = await getDataClient();
    return client.people.list({ treeId });
  });
  const pool = useMemo(() => (poolRes.data?.people ?? []) as PoolPerson[], [poolRes.data]);

  const faces = partners.map(faceOf);
  const taken = takenIds(partners, children);
  const unknown = tc('unknown');
  const shortOf = (f: StagedFace) => partnerShortName(f as PartnerPerson) || unknown;
  const names = faces.map(shortOf).join(' & ');

  // The family these two already share: fetched once both are in the tree.
  const p1 = partners[0] ? existingId(partners[0]) : null;
  const p2 = partners[1] ? existingId(partners[1]) : null;
  const [shared, setShared] = useState<{ pair: string; family: Family | null } | null>(null);
  useEffect(() => {
    if (p1 == null || p2 == null) return;
    let cancelled = false;
    (async () => {
      try {
        const client = await getDataClient();
        const person = await client.people.get(p1, treeId);
        if (!cancelled) setShared({ pair: `${p1}:${p2}`, family: sharedFamily((person?.familiesAsSpouse ?? []) as Family[], p1, p2) });
      } catch { /* only a warning: nothing to show */ }
    })();
    return () => { cancelled = true; };
  }, [p1, p2, treeId]);
  const sharedNow = p1 != null && p2 != null && shared?.pair === `${p1}:${p2}` ? shared.family : null;

  // A partner's recorded death ends the family; Active is then off.
  const dead = firstDeath(partners, pool);
  const ended = endedChosen || dead != null;
  const howNow: How | null = how ?? (dead ? 'death' : null);
  const hasEndData = isReason(howNow) && (endDate.trim() !== '' || endPlace.trim() !== '' || pending.some((p) => p.for === 'end'));

  const dirty = partners.length > 0 || children.length > 0 || type !== 'Marriage' || date !== '' || place !== ''
    || endedChosen || how != null || endDate !== '' || endPlace !== '' || pending.length > 0;
  const valid = partners.length > 0 || children.length > 0;

  const kidWindow = childWindow(faces);
  const likely = likelyChildren(faces, pool, taken);
  const suggestedPartners = partners.length === 1 ? partnerSuggestions(faces[0], pool, taken) : [];

  /* ── Changes ── */

  const addPartner = (picked: PickedPerson) => setPartners((ps) => (ps.length >= 2 ? ps : [...ps, stage(picked)]));
  const removePartner = (key: string) => setPartners((ps) => ps.filter((p) => p.key !== key));
  const addChildren = (picked: PickedPerson[]) => setChildren((cs) => [
    ...cs,
    ...picked.filter((p) => p.kind === 'new' || !cs.some((c) => existingId(c) === p.person.Id)).map((p) => ({ ...stage(p), links: {} })),
  ]);
  const setLinks = (key: string, l: ChildRelationships) => setChildren((cs) => cs.map((c) => {
    if (c.key !== key) return c;
    const links: StagedChild['links'] = {};
    if (partners[0]) links[partners[0].key] = l.partner1;
    if (partners[1]) links[partners[1].key] = l.partner2;
    return { ...c, links };
  }));
  const pickStatus = (v: string) => {
    if (v === 'ended') { setEndedChosen(true); return; }
    if (hasEndData) { setAskClear(true); return; }
    clearEnd();
  };
  const clearEnd = () => {
    setEndedChosen(false); setHow(null); setEndDate(''); setEndPlace(''); setEndPlaceRes(undefined); setEndPlaceId(null);
    setPending((ps) => ps.filter((p) => p.for !== 'end'));
    setAskClear(false);
  };
  /** A typed name as a new person: the first word first, the rest the last name. */
  const draft = (typed: string, lastName: string): PickedPerson => {
    const words = typed.trim().split(/\s+/).filter(Boolean);
    return { kind: 'new', draft: { firstName: words[0] ?? '', lastName: words.length > 1 ? words.slice(1).join(' ') : lastName, sex: null, birthDate: null } };
  };

  /* ── Save ── */

  async function save() {
    if (saving || !valid) return;
    setSaving(true);
    const client = await getDataClient();
    const result = await saveNewFamily(client, {
      treeId, partners, children, type,
      start: { date, place, placeId, resolution: placeRes },
      end: ended && isReason(howNow) ? { reason: howNow, date: endDate, place: endPlace, placeId: endPlaceId, resolution: endPlaceRes } : null,
      pending,
    }, flushPlace, {
      child: (name) => tef('partial_save_child', { name }),
      childName: (c) => displayFullName(faceOf(c)) || unknown,
      end: (reason) => tn('partial_end', { reason }),
      source: () => tef('partial_save_source'),
      citation: () => tef('partial_save_citation'),
    });
    if (!result.ok) {
      reportError(result.error);
      setSaving(false);
      return;
    }
    const name = coupleName((faces[0] as PartnerPerson) ?? null, (faces[1] as PartnerPerson) ?? null) || tp('family');
    if (result.failed.length > 0) showErrorToast(tef('partial_save_failed', { details: result.failed.join('; ') }));
    else showChangeToast({ message: tn('added', { name }) });
    onCreated(result.familyId);
  }

  /* ── Pieces ── */

  const startWord = tf(type === 'Marriage' ? 'married' : 'started');
  const citeLink = (what: CiteFor, label: string) => {
    const n = pending.filter((p) => p.for === what).length;
    return (
      <span className="inline-flex items-center gap-1.5">
        {n > 0 && <span className={citeClass({ square: false })}>{n}</span>}
        <ActionLink kind="action" aria-label={tn('cite_label', { what: label })} onClick={() => setCiting(what)}>{tn('cite')}</ActionLink>
      </span>
    );
  };
  const identity = (s: Staged, sub?: string | null) => {
    const f = faceOf(s);
    const isNew = s.picked.kind === 'new';
    return (
      <PersonIdentity as="span" nameStyle="serif" treeId={isNew ? null : treeId} name={displayFullName(f) || unknown}
        initials={getInitials(f.FirstName, f.LastName)} sex={f.Sex} mediaId={f.PrimaryMediaId ?? null}
        focalX={f.FocalX} focalY={f.FocalY} focalRadius={f.FocalRadius}
        lifespan={isNew ? <span>{tpk('new_badge')}</span> : f.BirthDate || f.DeathDate ? <Lifespan birth={f.BirthDate} death={f.DeathDate} /> : null}
        detail={sub} />
    );
  };
  const labelled = (id: string, label: string, control: React.ReactNode) => (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text-secondary">{label}</label>
      {control}
    </div>
  );
  const firstName = (f: StagedFace | undefined) => (f ? (f.FirstName ?? '').trim().split(/\s+/)[0] || shortOf(f) : null);

  /* ── Sections ── */

  const partnerSlot = (i: 0 | 1) => {
    const s = partners[i];
    if (s) {
      const others = pool.find((p) => p.Id === existingId(s))?.PartnershipCount ?? 0;
      return (
        <RecordBlock
          identity={identity(s, others > 0 ? tp('other_partnerships_count', { count: others }) : null)}
          onRemove={() => removePartner(s.key)}
          removeLabel={tn('remove_named', { name: displayFullName(faceOf(s)) || unknown })}
        />
      );
    }
    // Only the next free slot opens a finder; the second waits for the first.
    if (i === 1 && partners.length === 0) return <div aria-hidden="true" />;
    const title = partners.length ? tn('add_other_partner') : tf('add_partner_row');
    return (
      <PersonFinder
        title={title}
        treeId={treeId}
        excludeIds={taken}
        suggestions={suggestedPartners.map((person) => ({ person, reason: person.BirthDate ? t('born_year', { year: formatYearOrEmpty(person.BirthDate) }) : undefined }))}
        onPick={(p) => addPartner({ kind: 'existing', person: p })}
        onCreate={(typed) => addPartner(draft(typed, ''))}
        align={i === 1 ? 'end' : 'start'}
        trigger={(tp2) => <EmptySlot {...tp2} title={title} hint={partners.length ? t('partner_hint_other', { name: shortOf(faces[0]) }) : t('partner_hint')} />}
      />
    );
  };

  const deadYear = dead ? formatYearOrEmpty(dead.DeathDate) : '';
  const deadPlace = dead ? pool.find((p) => p.Id === dead.Id)?.DeathPlace ?? null : null;
  const ordered = inBirthOrder(children);
  const slotNames = { partner1: firstName(faces[0]), partner2: firstName(faces[1]) };

  return (
    <>
      <FormDialog
        open
        onClose={onClose}
        title={tn('title')}
        dirty={dirty}
        busy={saving}
        footer={(close) => (
          <>
            <Button variant="outline" onClick={close}>{tc('cancel')}</Button>
            <Button variant="primary" disabled={!valid || saving} onClick={() => void save()}>{saving ? tc('saving') : t('save_open')}</Button>
          </>
        )}
      >
        <FormBlock title={tp('partners')} className="pt-2">
          <FieldColumns>
            {partnerSlot(0)}
            {partnerSlot(1)}
          </FieldColumns>
          {sharedNow && (
            <WarningLine action={<ActionLink kind="leave" href={`/families/view?id=${sharedNow.Id}`}>{t('open')}</ActionLink>}>
              {t('shared', { family: coupleName(faces[0] as PartnerPerson, faces[1] as PartnerPerson) || tp('family') })}
            </WarningLine>
          )}
        </FormBlock>

        <div className="pt-5">
          <FieldColumns>
            <div className="grid gap-2.5 content-start">
              <label htmlFor={`${ids}-type`} className="eyebrow">{tp('row_type')}</label>
              <SelectField id={`${ids}-type`} size="sm" value={type} onChange={(v) => setType(v as FamilyType)}
                options={FAMILY_TYPES.map((v) => ({ value: v, label: tf(`ftype_${ftypeKey(v)}`) }))} />
            </div>
            <div className="grid gap-2.5 content-start">
              {/* The control names itself; the eyebrow is for the eye. */}
              <span className="eyebrow" aria-hidden="true">{tn('status')}</span>
              <SegmentedControl aria-label={tn('status')} fullWidth value={ended ? 'ended' : 'active'} onChange={pickStatus}
                options={[{ v: 'active', l: tn('active'), disabled: dead != null }, { v: 'ended', l: tn('ended') }]} />
              {dead && <p className="m-0 text-meta text-text-muted">{tn('death_forces', { name: shortOf(dead), year: deadYear || '?' })}</p>}
            </div>
          </FieldColumns>
        </div>

        <div className="pt-5">
          <FieldColumns>
            <FieldColumn title={startWord} action={citeLink('start', startWord)}>
              {labelled(`${ids}-date`, te('field_date'),
                <DateInput id={`${ids}-date`} value={date} onChange={setDate} className={fieldClass('sm')} />)}
              {labelled(`${ids}-place`, te('field_place'),
                <LocationField id={`${ids}-place`} value={place} onChange={setPlace} onResolve={setPlaceRes} onRemove={() => setPlaceRes(null)}
                  placeId={placeId} onPlaceIdChange={setPlaceId} label={te('field_place')}
                  treeId={treeId} className={fieldClass('sm')} placeholder={te('place_placeholder')} />)}
            </FieldColumn>
            <FieldColumn title={tn('ended')} inactive={!ended} inactiveReason={t('ended_inactive')}
              action={isReason(howNow) ? citeLink('end', tp(`reason_${howNow}`)) : undefined}>
              <div role="group" aria-label={tp('how_it_ended')} className="flex flex-wrap gap-1.5">
                {HOWS.map((v) => (
                  <FilterChip key={v} active={howNow === v} aria-pressed={howNow === v}
                    label={v === 'death' ? tp('death') : tp(`reason_${v}`)}
                    onClick={() => { setHow(v); setEndedChosen(true); }} />
                ))}
              </div>
              {ended && (isReason(howNow) ? (
                <>
                  {labelled(`${ids}-end-date`, te('field_date'),
                    <DateInput id={`${ids}-end-date`} value={endDate} onChange={setEndDate} className={fieldClass('sm')} />)}
                  {labelled(`${ids}-end-place`, te('field_place'),
                    <LocationField id={`${ids}-end-place`} value={endPlace} onChange={setEndPlace} onResolve={setEndPlaceRes} onRemove={() => setEndPlaceRes(null)}
                      placeId={endPlaceId} onPlaceIdChange={setEndPlaceId} label={te('field_place')}
                      treeId={treeId} className={fieldClass('sm')} placeholder={te('place_placeholder')} />)}
                </>
              ) : howNow === 'death' ? (
                <p className="m-0 text-sm text-text-secondary">
                  {dead ? (
                    <>
                      {t('ended_death', { name: shortOf(dead), year: deadYear || 'none', place: deadPlace || 'none' })}{' '}
                      <ActionLink kind="leave" href={`/people/view?id=${dead.Id}`}>{t('open')}</ActionLink>
                    </>
                  ) : tn('death_none')}
                </p>
              ) : (
                <p className="m-0 text-meta text-text-muted">{tn('pick_how')}</p>
              ))}
            </FieldColumn>
          </FieldColumns>
        </div>

        <FormBlock title={children.length ? tn('children_count', { count: children.length }) : tp('children')}>
          {ordered.map((c) => {
            const l = slotLinks(c, partners);
            return (
              <RecordBlock key={c.key} identity={identity(c)} onRemove={() => setChildren((cs) => cs.filter((x) => x.key !== c.key))}
                removeLabel={tn('remove_named', { name: displayFullName(faceOf(c)) || unknown })}>
                {partners.length > 0 && (
                  <ParentRelationshipSelects value={l} onChange={(v) => setLinks(c.key, v)}
                    partner1Name={slotNames.partner1} partner2Name={partners.length === 2 ? slotNames.partner2 : null} />
                )}
              </RecordBlock>
            );
          })}
          {kidWindow && likely.length > 0 && (
            <div className="-mx-2 grid">
              {likely.slice(0, 3).map((p) => (
                <SuggestionRow key={p.Id} onClick={() => addChildren([{ kind: 'existing', person: p }])}
                  aria-label={tn('add_as_child', { name: displayFullName(p) || unknown })}
                  identity={<PersonIdentity as="span" treeId={treeId} name={displayFullName(p) || unknown} initials={getInitials(p.FirstName, p.LastName)} sex={p.Sex}
                    mediaId={p.PrimaryMediaId ?? null} focalX={p.FocalX} focalY={p.FocalY} focalRadius={p.FocalRadius}
                    lifespan={p.BirthDate || p.DeathDate ? <Lifespan birth={p.BirthDate} death={p.DeathDate} /> : null} />}
                  reason={t('likely_reason', { from: kidWindow.from, to: kidWindow.to })} />
              ))}
            </div>
          )}
          <PersonFinder
            multiple
            title={tn('add_children')}
            treeId={treeId}
            excludeIds={taken}
            suggestions={kidWindow ? likely.map((person: PersonResult) => ({ person, reason: t('likely_reason', { from: kidWindow.from, to: kidWindow.to }) })) : []}
            onPickMany={(ps) => addChildren(ps.map((person) => ({ kind: 'existing', person })))}
            onCreate={(typed) => addChildren([draft(typed, faces[0]?.LastName ?? '')])}
            addManyLabel={(count) => t('add_n_children', { count })}
            trigger={(tp2) => (children.length
              ? <div><ActionLink kind="action" {...tp2}>{tn('add_more_children')}</ActionLink></div>
              : <EmptySlot {...tp2} title={tn('add_children')} hint={names ? t('children_hint', { names }) : t('children_hint_alone')} />)}
          />
        </FormBlock>
        <p className="m-0 pt-4 text-meta text-text-muted">{t('more_on_page')}</p>
      </FormDialog>

      {citing && (
        <AttachSourceSidebar
          factTable={citing === 'start' ? FACT_TABLES.FAMILIES : FACT_TABLES.EVENTS}
          factId={null}
          factLabel={citing === 'start' ? startWord : isReason(howNow) ? tp(`reason_${howNow}`) : tn('ended')}
          personName={names || tn('title')}
          onClose={() => setCiting(null)}
          onPending={(pc) => { const what = citing; setPending((ps) => [...ps, { ...pc, for: what }]); }}
          onAttached={() => {}}
        />
      )}

      <ConfirmDialog
        open={askClear}
        variant="calm"
        elevated
        title={tn('clear_end_title', { reason: isReason(howNow) ? howNow : 'Divorce' })}
        body={tn('clear_end_body')}
        confirmLabel={tn('clear_end_pill', { reason: isReason(howNow) ? howNow : 'Divorce' })}
        cancelLabel={tn('keep_it')}
        onConfirm={clearEnd}
        onCancel={() => setAskClear(false)}
      />
    </>
  );
}
