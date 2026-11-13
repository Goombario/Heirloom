'use client';

import React, { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PersonResult } from '@/lib/db/schema';
import type { FamilySuggestion } from '@/lib/family-suggestions';
import type { ChildRelationships } from '@/lib/child-relationship';
import { getDataClient } from '@/lib/data';
import { FACT_TABLES, type FactTableValue } from '@/lib/db/fact-tables';
import { formatYearOrEmpty } from '@/lib/date-utils';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import { Star, X } from '@/lib/icons';
import AttachSourceSidebar from '@/app/components/AttachSourceSidebar';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import DateInput from '@/app/components/DateInput';
import LocationField from '@/app/components/LocationField';
import type { NewPersonDraft } from '@/app/components/PersonPickerSheet';
import { usePersonForm, type FamilySearchResult, type UsePersonForm } from '@/app/components/person-form/usePersonForm';
import {
  ActionLink, Banner, Button, EmptySlot, FieldColumn, FieldColumns, FilterChip, FormBlock, FormDialog, IconButton, Input,
  Lifespan, ParentRelationshipSelects, PersonFinder, PersonIdentity, RecordBlock, SegmentedControl, SuggestionRow, WarningLine,
  citeClass, cx, fieldClass,
} from '@/app/components/ui';

/** The six name types (ADR 0001), in the chips' order. */
const NAME_TYPES = ['Nickname', 'Maiden', 'Married', 'Anglicized', 'Alias', 'Given'] as const;

type Status = '' | '0' | '1';
type T = ReturnType<typeof useTranslations<'mobileAddPerson'>>;

/*
 * Add person on desktop (#52): the locked quick-add dialog over the People list.
 * Essentials only: names, sex and status, born and died, parents and a partner,
 * each from a popover finder over the dialog. "Save and open" creates the person and
 * opens their page, where everything else (cause of death, children, notes) is added.
 * Everything is written on Save by usePersonForm, the phone sheet's own logic.
 */
export function AddPersonDialog({ open, onClose, treeId }: { open: boolean; onClose: () => void; treeId: number | null }) {
  // A fresh form each time it opens.
  const [opened, setOpened] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpened((n) => n + 1);
  }
  if (!open) return null;
  return <AddPersonBody key={opened} onClose={onClose} treeId={treeId} />;
}

function AddPersonBody({ onClose, treeId }: { onClose: () => void; treeId: number | null }) {
  const t = useTranslations('addPersonDialog');
  const tm = useTranslations('mobileAddPerson');
  const tc = useTranslations('common');
  const fm = usePersonForm({ mode: 'new' });
  const { form, setField, firstNameRef } = fm;
  const ids = useId();
  const [statusAsk, setStatusAsk] = useState<'0' | '' | null>(null);
  const [naming, setNaming] = useState(false);

  const fullName = [form.FirstName.trim(), form.LastName.trim()].filter(Boolean).join(' ');
  const given = form.FirstName.trim().split(/\s+/)[0] || tm('this_person');
  const canSave = fullName !== '' && !fm.saving;

  const save = (addAnother: boolean) => { if (canSave) void fm.submit({ addAnother }); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(true); }
  };

  const setStatus = (v: Status) => {
    const hasDeath = Boolean(form.DeathDate.trim() || form.DeathPlace.trim() || form.DeathCause.trim());
    if (v !== '1' && hasDeath) { setStatusAsk(v); return; }
    setField('IsDeceased', v);
  };
  const clearDeath = () => {
    if (statusAsk == null) return;
    setField('DeathDate', '');
    setField('DeathPlace', '');
    setField('DeathCause', '');
    fm.setDeathPlaceResolution(undefined);
    setField('IsDeceased', statusAsk);
    setStatusAsk(null);
  };

  // The name block says "Cite a source"; the narrower Born and Died columns say "Cite" (locked board).
  const citeLink = (factTable: FactTableValue, label: string, short = false) => {
    const n = fm.pendingCitations.filter((p) => p.factTable === factTable).length;
    return (
      <span className="inline-flex items-center gap-1.5">
        {n > 0 && <span className={citeClass({ square: false })}>{n}</span>}
        <ActionLink kind="action" aria-label={tm('cite_fact', { fact: label })}
          onClick={() => fm.setAttachTarget({ factTable, factId: -1, factLabel: label })}>{short ? t('cite_short') : t('cite')}</ActionLink>
      </span>
    );
  };

  return (
    <>
      <FormDialog
        open
        onClose={onClose}
        title={t('title')}
        dirty={fm.isDirty}
        busy={fm.saving}
        footerStart={<Button variant="ghost" disabled={!canSave} onClick={() => save(true)} title="Ctrl+Enter">{t('save_another')}</Button>}
        footer={(close) => (
          <>
            <Button variant="outline" onClick={close}>{tc('cancel')}</Button>
            <Button variant="primary" disabled={!canSave} onClick={() => save(false)}>{fm.saving ? tc('saving') : t('save_open')}</Button>
          </>
        )}
      >
        <div onKeyDown={onKeyDown}>
          {fm.error && <Banner tone="error" className="mt-3">{fm.error}</Banner>}
          {fm.successMessage && <Banner tone="success" className="mt-3">{fm.successMessage}</Banner>}

          <FormBlock title={tm('group_name')} action={citeLink(FACT_TABLES.PERSON_NAME, tm('group_name'))} className="pt-2">
            <FieldColumns>
              <Input size="sm" label={tm('first_name')} ref={firstNameRef} value={form.FirstName} autoComplete="off"
                aria-invalid={fm.fieldErrors.FirstName || undefined} onChange={(e) => setField('FirstName', e.target.value)} />
              <Input size="sm" label={tm('last_name')} value={form.LastName} autoComplete="off"
                aria-invalid={fm.fieldErrors.LastName || undefined} onChange={(e) => setField('LastName', e.target.value)} />
            </FieldColumns>
            {fm.variants.length > 0 && (
              <ul className="list-none m-0 p-0 grid gap-0.5">
                {fm.variants.map((v) => (
                  <li key={v.Id} className="flex items-center gap-1 min-h-8">
                    <IconButton
                      label={v.IsPrimary ? t('unstar', { name: v.Name }) : t('star', { name: v.Name })}
                      aria-pressed={!!v.IsPrimary}
                      onClick={() => fm.stageVariant({ Id: v.Id, Type: v.Type, Name: v.Name, IsPrimary: !v.IsPrimary })}
                      icon={<Star className={cx('w-4 h-4', v.IsPrimary ? 'fill-current text-text' : 'text-text-muted')} aria-hidden="true" />}
                    />
                    <span className="serif text-base font-semibold text-text">{v.Name}</span>
                    <span className="text-meta text-text-muted">· {nameType(tm, v.Type)}</span>
                    <IconButton label={t('remove_name', { name: v.Name })} onClick={() => void fm.removeNameVariant(v.Id)}
                      icon={<X className="w-4 h-4" aria-hidden="true" />} />
                  </li>
                ))}
              </ul>
            )}
            {naming
              ? <NamePanel fm={fm} given={given} onClose={() => setNaming(false)} />
              : <div><ActionLink plus onClick={() => setNaming(true)}>{t('add_name')}</ActionLink></div>}
            <Duplicates fm={fm} />
          </FormBlock>

          <div className="pt-5">
            <FieldColumns>
              <Segment label={tm('sex')}>
                <SegmentedControl aria-label={tm('sex')} fullWidth className="whitespace-nowrap" value={form.Sex} onChange={(v) => setField('Sex', v)}
                  options={[
                    { v: '', l: tm('sex_unknown') }, { v: 'M', l: tm('sex_male') },
                    { v: 'F', l: tm('sex_female') }, { v: 'X', l: tm('sex_nonbinary') },
                  ]} />
              </Segment>
              <Segment label={tm('status')}>
                <SegmentedControl aria-label={tm('status')} fullWidth value={form.IsDeceased} onChange={(v) => setStatus(v as Status)}
                  options={[
                    { v: '', l: tm('status_unknown') }, { v: '0', l: tm('status_living') }, { v: '1', l: tm('status_deceased') },
                  ]} />
              </Segment>
            </FieldColumns>
          </div>

          <div className="pt-5">
            <FieldColumns>
              <FieldColumn title={tm('group_born')} action={citeLink(FACT_TABLES.PERSON_BIRTH, tm('group_born'), true)}>
                <Labelled id={`${ids}-bdate`} label={tm('date')}>
                  <DateInput id={`${ids}-bdate`} value={form.BirthDate} onChange={(v) => setField('BirthDate', v)} className={fieldClass('sm')} />
                </Labelled>
                <Labelled id={`${ids}-bplace`} label={tm('place')}>
                  <LocationField id={`${ids}-bplace`} value={form.BirthPlace} onChange={(v) => setField('BirthPlace', v)}
                    onResolve={fm.setBirthPlaceResolution} onRemove={() => fm.setBirthPlaceResolution(null)}
                    placeId={fm.placeIds.birth} onPlaceIdChange={(id) => fm.setPlaceId('birth', id)} label={tm('group_born')}
                    treeId={treeId} className={fieldClass('sm')} placeholder={tm('place_placeholder')} />
                </Labelled>
              </FieldColumn>
              <FieldColumn title={tm('group_died')} inactive={form.IsDeceased === '0'} inactiveReason={t('died_living')}
                action={citeLink(FACT_TABLES.PERSON_DEATH, tm('group_died'), true)}>
                <Labelled id={`${ids}-ddate`} label={tm('date')}>
                  <DateInput id={`${ids}-ddate`} value={form.DeathDate} onChange={(v) => setField('DeathDate', v)} className={fieldClass('sm')} />
                </Labelled>
                <Labelled id={`${ids}-dplace`} label={tm('place')}>
                  <LocationField id={`${ids}-dplace`} value={form.DeathPlace} onChange={(v) => setField('DeathPlace', v)}
                    onResolve={fm.setDeathPlaceResolution} onRemove={() => fm.setDeathPlaceResolution(null)}
                    placeId={fm.placeIds.death} onPlaceIdChange={(id) => fm.setPlaceId('death', id)} label={tm('group_died')}
                    treeId={treeId} className={fieldClass('sm')} placeholder={tm('place_placeholder')} />
                </Labelled>
              </FieldColumn>
            </FieldColumns>
          </div>

          <Family fm={fm} treeId={treeId} given={given} ids={ids} />
        </div>
      </FormDialog>

      {fm.attachTarget && (
        <AttachSourceSidebar
          factTable={fm.attachTarget.factTable}
          factId={null}
          factLabel={fm.attachTarget.factLabel}
          personName={fullName || t('title')}
          onClose={() => fm.setAttachTarget(null)}
          onPending={fm.pushPendingCitation}
          onAttached={() => {}}
        />
      )}

      <ConfirmDialog
        open={statusAsk != null}
        variant="calm"
        elevated
        title={tm('clear_death_title', { status: statusAsk === '0' ? 'living' : 'unknown' })}
        body={tm('clear_death_body')}
        confirmLabel={tm('clear_death_confirm')}
        cancelLabel={tm('keep_death')}
        onConfirm={clearDeath}
        onCancel={() => setStatusAsk(null)}
      />
      {/* The form's own check on Save, should a death survive a status change. */}
      <ConfirmDialog
        open={fm.clearDeathPending != null}
        variant="calm"
        elevated
        title={tm('clear_death_title', { status: form.IsDeceased === '0' ? 'living' : 'unknown' })}
        body={tm('clear_death_body')}
        confirmLabel={tm('clear_death_confirm')}
        cancelLabel={tm('keep_death')}
        onConfirm={fm.confirmClearDeath}
        onCancel={fm.cancelClearDeath}
      />
    </>
  );
}

/* ── Layout pieces ───────────────────────────────────────────────────────── */

function Segment({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2.5">
      {/* The control names itself; the eyebrow is for the eye. */}
      <span className="eyebrow" aria-hidden="true">{label}</span>
      {children}
    </div>
  );
}

function Labelled({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function nameType(t: T, type: string) {
  const key = `vtype_${type.toLowerCase()}`;
  return t.has(key as Parameters<T>[0]) ? t(key as Parameters<T>[0]) : type;
}

const familyName = (f: { husbandName: string | null; wifeName: string | null }, t: T) =>
  [f.husbandName, f.wifeName].filter(Boolean).join(' & ') || t('unknown_family');

const familySub = (f: { MarriageDate?: string | null; marriageDate?: string | null; childCount?: number }, t: T) => [
  (f.MarriageDate ?? f.marriageDate) ? t('married_year', { year: formatYearOrEmpty(f.MarriageDate ?? f.marriageDate) }) : null,
  f.childCount != null ? t('children_count', { count: f.childCount }) : null,
].filter(Boolean).join(' · ');

const draftName = (d: NewPersonDraft, t: T) => [d.firstName, d.lastName].filter(Boolean).join(' ') || t('unnamed');

/** A typed name staged as a new person: first word first, the rest the last name. */
const draftFrom = (typed: string, lastName: string): NewPersonDraft => {
  const words = typed.trim().split(/\s+/).filter(Boolean);
  return { firstName: words[0] ?? '', lastName: words.length > 1 ? words.slice(1).join(' ') : lastName, sex: null, birthDate: null };
};

/* ── Another name ────────────────────────────────────────────────────────── */

/**
 * "Add another name": the six type chips, the name and Add name. A first nickname
 * becomes the shown first name and takes the star (#1232, ADR 0001); the star on
 * its row moves it back.
 */
function NamePanel({ fm, given, onClose }: { fm: UsePersonForm; given: string; onClose: () => void }) {
  const t = useTranslations('addPersonDialog');
  const tm = useTranslations('mobileAddPerson');
  const tc = useTranslations('common');
  const [type, setType] = useState<string>('Nickname');
  const [name, setName] = useState('');
  const add = () => {
    if (!name.trim()) return;
    fm.stageVariant({ Type: type, Name: name, IsPrimary: type === 'Nickname' && !fm.variants.some((v) => v.IsPrimary) });
    onClose();
  };
  return (
    <div className="inline-panel grid gap-3" role="group" aria-label={t('add_name')}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div role="group" aria-label={tm('name_type')} className="flex flex-wrap gap-1.5">
        {NAME_TYPES.map((x) => (
          <FilterChip key={x} active={type === x} label={nameType(tm, x)} aria-pressed={type === x} onClick={() => setType(x)} />
        ))}
      </div>
      <Input size="sm" label={tm('name_field')} value={name} autoFocus maxLength={200} autoComplete="off"
        hint={type === 'Nickname' && !fm.variants.some((v) => v.IsPrimary) ? tm('show_as_first_sub', { name: given }) : undefined}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>{tc('cancel')}</Button>
        <Button variant="outline" size="sm" disabled={!name.trim()} onClick={add}>{t('add_name_button')}</Button>
      </div>
    </div>
  );
}

/* ── Duplicates ──────────────────────────────────────────────────────────── */

/** "Already in the tree? Anna Berg, 1893": one warning line, the match opening in a new tab. */
function Duplicates({ fm }: { fm: UsePersonForm }) {
  const t = useTranslations('addPersonDialog');
  const match = fm.potentialDuplicates[0];
  if (!match) return null;
  const year = formatYearOrEmpty(match.BirthDate);
  return (
    <WarningLine action={<ActionLink kind="leave" href={`/people/view?id=${match.Id}`}>{t('open')}</ActionLink>}>
      {t('duplicate', { name: displayFullName(match), year: year || 'none' })}
    </WarningLine>
  );
}

/* ── Family ──────────────────────────────────────────────────────────────── */

function Family({ fm, treeId, given, ids }: { fm: UsePersonForm; treeId: number | null; given: string; ids: string }) {
  const t = useTranslations('addPersonDialog');
  const tm = useTranslations('mobileAddPerson');
  const parentPicked = (fm.attachAsChild && fm.selectedFamily != null) || fm.newParent != null;
  const partnerPicked = (fm.attachAsPartner && fm.selectedSpouse != null) || fm.newSpouse != null;
  const suggestions = fm.visibleSuggestions.filter((s) => (s.role === 'child' ? !parentPicked : !partnerPicked));

  // Families come back as finder rows; the cache maps a picked row to its family.
  const familyCache = useRef(new Map<number, FamilySearchResult>());
  const searchFamilies = async (q: string): Promise<PersonResult[]> => {
    const client = await getDataClient();
    const found = (await client.families.search(q, treeId)) as FamilySearchResult[];
    familyCache.current = new Map(found.map((f) => [f.Id, f]));
    return found.map((f) => asRow(f, tm));
  };
  const likelyFamilies: FamilySearchResult[] = fm.visibleSuggestions.filter((s) => s.role === 'child' && s.familyId != null).map((s) => ({
    Id: s.familyId!, Partner1Id: null, Partner2Id: null, MarriageDate: s.marriageDate, husbandName: s.husbandName, wifeName: s.wifeName, childCount: s.childCount ?? 0,
  }));

  const pickFamily = (f: FamilySearchResult) => {
    fm.setNewParent(null);
    fm.setSelectedFamily(f);
    fm.setAttachAsChild(true);
    fm.setParentLinks({ partner1: 'Birth', partner2: 'Birth' });
  };
  const pickPartner = (p: PersonResult) => { fm.setNewSpouse(null); fm.setSelectedSpouse(p); fm.setAttachAsPartner(true); };
  const take = (s: FamilySuggestion) => {
    if (s.role === 'child') {
      pickFamily({ Id: s.familyId!, Partner1Id: null, Partner2Id: null, MarriageDate: s.marriageDate, husbandName: s.husbandName, wifeName: s.wifeName, childCount: s.childCount ?? 0 });
    } else {
      pickPartner({ Id: s.personId!, FirstName: s.personFirstName, LastName: s.personLastName, EffectiveFirstName: s.personEffectiveFirstName, Nickname: s.personNickname, Sex: null, BirthDate: s.personBirthDate, DeathDate: null });
    }
  };
  const removeParents = () => { fm.setSelectedFamily(null); fm.setAttachAsChild(false); fm.setNewParent(null); fm.setChildRelationshipType('Birth'); fm.setParentLinks(null); };
  const removePartner = () => {
    fm.setSelectedSpouse(null); fm.setAttachAsPartner(false); fm.setNewSpouse(null);
    fm.setMarriageDate(''); fm.setMarriagePlace(''); fm.setMarriagePlaceResolution(undefined);
  };

  const partnerSuggestions: PersonResult[] = fm.visibleSuggestions.filter((s) => s.role === 'spouse' && s.personId != null).map((s) => ({
    Id: s.personId!, FirstName: s.personFirstName, LastName: s.personLastName, EffectiveFirstName: s.personEffectiveFirstName,
    Nickname: s.personNickname, Sex: null, BirthDate: s.personBirthDate, DeathDate: null,
  }));

  const firstOf = (name: string | null) => (name ?? '').trim().split(/\s+/)[0] || null;
  const fam = fm.selectedFamily;
  const links: ChildRelationships = fm.parentLinks ?? { partner1: fm.childRelationshipType, partner2: fm.childRelationshipType };

  return (
    <>
      {suggestions.length > 0 && (
        <FormBlock title={tm('likely_family')}>
          <div className="-mx-2 grid">
            {suggestions.map((s) => (
              <SuggestionRow
                key={`${s.role}-${s.familyId ?? s.personId}`}
                onClick={() => take(s)}
                identity={<span className="text-base text-text">{s.role === 'child'
                  ? tm('child_of', { family: familyName(s, tm) })
                  : tm('partner_of', { name: s.personName || [s.personFirstName, s.personLastName].filter(Boolean).join(' ') || tm('unnamed') })}</span>}
                reason={(s.role === 'child' ? familySub(s, tm) : s.personBirthDate ? tm('born_year', { year: formatYearOrEmpty(s.personBirthDate) }) : '') || undefined}
              />
            ))}
          </div>
        </FormBlock>
      )}

      <FormBlock title={tm('parents')}>
        {parentPicked ? (
          fm.newParent ? (
            <RecordBlock
              identity={<PersonIdentity as="span" name={draftName(fm.newParent, tm)} initials={getInitials(fm.newParent.firstName, fm.newParent.lastName)} sex={fm.newParent.sex} lifespan={<span>{tm('new_badge')}</span>} />}
              onRemove={removeParents} removeLabel={t('remove', { name: draftName(fm.newParent, tm) })}
            />
          ) : fam && (
            <RecordBlock
              identity={<span className="grid"><span className="serif text-md font-semibold text-text">{familyName(fam, tm)}</span>
                {familySub(fam, tm) && <span className="text-meta text-text-muted">{familySub(fam, tm)}</span>}</span>}
              onRemove={removeParents} removeLabel={t('remove', { name: familyName(fam, tm) })}
            >
              <ParentRelationshipSelects value={links} onChange={fm.setParentLinks}
                partner1Name={fam.husbandName ? firstOf(fam.husbandName) : null}
                partner2Name={fam.wifeName ? firstOf(fam.wifeName) : null} />
            </RecordBlock>
          )
        ) : (
          <PersonFinder
            title={t('find_parents')}
            treeId={treeId}
            search={searchFamilies}
            suggestions={likelyFamilies.map((f) => ({ person: asRow(f, tm), reason: familySub(f, tm) || undefined }))}
            onPick={(row) => {
              const f = familyCache.current.get(row.Id) ?? likelyFamilies.find((x) => x.Id === row.Id);
              if (f) pickFamily(f);
            }}
            onCreate={(typed) => { fm.setSelectedFamily(null); fm.setAttachAsChild(false); fm.setNewParent(draftFrom(typed, fm.form.LastName.trim())); }}
            trigger={(p) => <EmptySlot {...p} title={t('find_parents')} hint={t('find_parents_hint', { name: given })} />}
          />
        )}
      </FormBlock>

      <FormBlock title={tm('partner')}>
        {partnerPicked ? (
          <RecordBlock
            identity={fm.newSpouse
              ? <PersonIdentity as="span" name={draftName(fm.newSpouse, tm)} initials={getInitials(fm.newSpouse.firstName, fm.newSpouse.lastName)} sex={fm.newSpouse.sex} lifespan={<span>{tm('new_badge')}</span>} />
              : <PersonIdentity as="span" treeId={treeId} name={displayFullName(fm.selectedSpouse!) || tm('unnamed')}
                initials={getInitials(fm.selectedSpouse!.FirstName, fm.selectedSpouse!.LastName)} sex={fm.selectedSpouse!.Sex}
                lifespan={fm.selectedSpouse!.BirthDate || fm.selectedSpouse!.DeathDate ? <Lifespan birth={fm.selectedSpouse!.BirthDate} death={fm.selectedSpouse!.DeathDate} /> : null} />}
            onRemove={removePartner}
            removeLabel={t('remove', { name: fm.newSpouse ? draftName(fm.newSpouse, tm) : displayFullName(fm.selectedSpouse!) || tm('unnamed') })}
          >
            <FieldColumns>
              <Labelled id={`${ids}-mdate`} label={tm('married')}>
                <DateInput id={`${ids}-mdate`} value={fm.marriageDate} onChange={fm.setMarriageDate} className={fieldClass('sm')} />
              </Labelled>
              <Labelled id={`${ids}-mplace`} label={tm('where')}>
                <LocationField id={`${ids}-mplace`} value={fm.marriagePlace} onChange={fm.setMarriagePlace}
                  onResolve={fm.setMarriagePlaceResolution} onRemove={() => fm.setMarriagePlaceResolution(null)}
                  placeId={fm.placeIds.marriage} onPlaceIdChange={(id) => fm.setPlaceId('marriage', id)} label={tm('where')}
                  treeId={treeId} className={fieldClass('sm')} placeholder={tm('place_placeholder')} />
              </Labelled>
            </FieldColumns>
          </RecordBlock>
        ) : (
          <PersonFinder
            title={t('find_partner')}
            treeId={treeId}
            suggestions={partnerSuggestions.map((person) => ({ person }))}
            onPick={pickPartner}
            onCreate={(typed) => { fm.setSelectedSpouse(null); fm.setNewSpouse(draftFrom(typed, '')); fm.setAttachAsPartner(true); }}
            trigger={(p) => <EmptySlot {...p} title={t('find_partner')} hint={t('find_partner_hint', { name: given })} />}
          />
        )}
      </FormBlock>
      <p className="m-0 pt-4 text-meta text-text-muted">{t('more_on_page')}</p>
    </>
  );
}

/** A family as a finder row: its couple's names as the title. */
function asRow(f: FamilySearchResult, t: T): PersonResult {
  return { Id: f.Id, FirstName: familyName(f, t), LastName: null, Sex: null, BirthDate: null, DeathDate: null };
}
