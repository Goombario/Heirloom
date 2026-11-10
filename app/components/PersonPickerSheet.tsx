'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PersonResult } from '@/lib/db/schema';
import { getDataClient } from '@/lib/data';
import { parseUserDateInput } from '@/lib/date-utils';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import { personKin } from '@/lib/utils/person-kin';
import { Plus, Search } from '@/lib/icons';
import PersonAvatar from '@/app/components/PersonAvatar';
import { Lifespan, MobileRow, SegmentedControl } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';

/** The short New person form's fields, for the caller to stage or create. */
export interface NewPersonDraft {
  firstName: string;
  lastName: string;
  /** 'M' | 'F' | 'X', or null when unknown. */
  sex: string | null;
  /** Stored date form (parseUserDateInput), or null. */
  birthDate: string | null;
}

/** One pick: someone already in the tree, or a person to create. */
export type PickedPerson =
  | { kind: 'existing'; person: PersonResult }
  | { kind: 'new'; draft: NewPersonDraft };

interface PersonPickerSheetProps {
  open: boolean;
  onClose: () => void;
  /** The sheet's title ("Add partner"). */
  title: string;
  treeId?: number | null;
  /** People who can't be picked (the person themself, partners already linked). */
  excludeIds?: number[];
  /** Shown above the results before anything is typed. */
  suggested?: { label: string; people: PersonResult[] };
  /** Several picks before one "Add N" (Add children). Otherwise one tap picks. */
  multiple?: boolean;
  /** Picks, in order. The caller decides what they mean: the Add person and New family
   *  forms stage new people and create them on Save; the person and family pages
   *  create them when this is called. The caller closes the sheet or moves on. */
  onPick: (picked: PickedPerson[]) => void;
  /** Offer "Create a new person" first (editors). */
  allowCreate?: boolean;
  /** The short form's last name when nothing was typed (a child takes the family's). */
  defaultLastName?: string;
  /** A line under the short form saying what Add will do. */
  createHint?: string;
  /** Shows "‹ Back" instead of Cancel: the picker is a step inside a larger flow. */
  onBack?: () => void;
  /** Multiple only: told the ticked people as they change, so the caller can offer their family. */
  onPickedChange?: (ids: number[]) => void;
  /** Multiple only: groups shown under the picks before anything is typed (a ticked
   *  person's family, with each relation word), each with a "Tick all" link. */
  related?: { key: string; label: string; people: (PersonResult & { relation: string })[] }[];
  /** Multiple only: the header pill's word for N picks ("Next · 3"); default "Add N". */
  pickLabel?: (count: number) => string;
}

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY = 2;
const RESULT_LIMIT = 20;

/**
 * The mobile person picker (#1059): a full-height sheet with search, the caller's
 * suggestions above the results, and content rows where one tap picks. With
 * `multiple`, rows are checkboxes and the header pill reads "Add N". "Create a new
 * person" comes first and opens the short New person form (first and last name, sex,
 * born) in the same sheet, with Back to the search. The short form is its own
 * component, not the full person form in a short mode: four fields share nothing with
 * that form's sections, citations and family steps.
 */
export function PersonPickerSheet({
  open, onClose, title, treeId, excludeIds, suggested, multiple = false, onPick,
  allowCreate = false, defaultLastName, createHint, onBack, onPickedChange, related, pickLabel,
}: PersonPickerSheetProps) {
  const t = useTranslations('personPicker');
  const tc = useTranslations('common');
  const [step, setStep] = useState<'search' | 'create'>('search');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PickedPerson[]>([]);
  const [draft, setDraft] = useState<DraftFields>(EMPTY_DRAFT);
  const [bornError, setBornError] = useState(false);

  // A fresh picker each time it opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep('search'); setQuery(''); setPicked([]); setDraft(EMPTY_DRAFT); setBornError(false);
    }
  }

  const { results, state } = usePeopleSearch(query, treeId);
  const excluded = new Set(excludeIds ?? []);
  const isPicked = (id: number) => picked.some(p => p.kind === 'existing' && p.person.Id === id);
  const typed = query.trim();
  const shown = (typed.length >= MIN_QUERY ? results : suggested?.people ?? []).filter(p => !excluded.has(p.Id));

  const setPicks = (next: PickedPerson[]) => {
    setPicked(next);
    onPickedChange?.(next.flatMap(p => (p.kind === 'existing' ? [p.person.Id] : [])));
  };
  const choose = (person: PersonResult) => {
    if (!multiple) { onPick([{ kind: 'existing', person }]); return; }
    setPicks(isPicked(person.Id)
      ? picked.filter(p => !(p.kind === 'existing' && p.person.Id === person.Id))
      : [...picked, { kind: 'existing', person }]);
  };
  const tickAll = (people: PersonResult[]) => {
    setPicks([...picked, ...people.filter(p => !isPicked(p.Id)).map((person): PickedPerson => ({ kind: 'existing', person }))]);
  };

  const startCreate = () => {
    const words = typed.split(/\s+/).filter(Boolean);
    setDraft({
      ...EMPTY_DRAFT,
      firstName: words[0] ?? '',
      lastName: words.length > 1 ? words.slice(1).join(' ') : defaultLastName ?? '',
    });
    setBornError(false);
    setStep('create');
  };

  const addDraft = () => {
    const made = toNewPerson(draft);
    if (!made) { setBornError(true); return; }
    const created: PickedPerson = { kind: 'new', draft: made };
    if (!multiple) { onPick([created]); return; }
    setPicked(cur => [...cur, created]);
    setQuery('');
    setStep('search');
  };

  if (step === 'create') {
    const touched = draft.firstName.trim() !== '' || draft.lastName.trim() !== '' || draft.sex !== '' || draft.born.trim() !== '';
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title={t('new_person')}
        size="full"
        dirty={touched}
        onBack={() => setStep('search')}
        onSave={addDraft}
        saveLabel={tc('add')}
        saveDisabled={!draft.firstName.trim() && !draft.lastName.trim()}
      >
        <ShortPersonForm
          value={draft}
          onChange={(next) => { setDraft(next); if (next.born !== draft.born) setBornError(false); }}
          bornError={bornError}
          hint={createHint}
        />
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      size="full"
      onBack={onBack}
      dirty={multiple && picked.length > 0}
      onSave={multiple ? () => onPick(picked) : undefined}
      saveLabel={multiple ? (pickLabel ? pickLabel(picked.length) : picked.length > 1 ? t('add_n', { count: picked.length }) : tc('add')) : undefined}
      saveDisabled={multiple && picked.length === 0}
    >
      <div className="relative">
        <Search className="absolute left-3 top-[13px] w-[18px] h-[18px] text-text-muted pointer-events-none" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search_placeholder')}
          aria-label={t('search_placeholder')}
          autoComplete="off"
          className="w-full min-h-11 rounded-xl border border-border bg-surface pl-[38px] pr-3 text-md text-text placeholder:text-text-muted input-nozoom focus-ring"
        />
      </div>

      <div className="-mx-4 mt-2" aria-live="polite">
        {allowCreate && (
          <MobileRow
            icon={<Plus />}
            label={typed ? t('create_named', { name: typed }) : t('create_new')}
            end="chevron"
            onClick={startCreate}
          />
        )}
        {multiple && picked.filter(p => p.kind === 'new').map((p, i) => p.kind === 'new' && (
          <MobileRow
            key={`new-${i}`}
            divided
            checked
            label={[p.draft.firstName, p.draft.lastName].filter(Boolean).join(' ')}
            sub={t('new_badge')}
            onClick={() => setPicked(cur => cur.filter(x => x !== p))}
          />
        ))}
        {!typed && multiple && related && (() => {
          // The ticked people first (those no family group lists), then each group.
          const inGroups = new Set(related.flatMap(g => g.people.map(p => p.Id)));
          const lone = picked.flatMap(p => (p.kind === 'existing' && !inGroups.has(p.person.Id) ? [p.person] : []));
          return (
            <>
              {lone.length > 0 && <div className="eyebrow px-4 pt-4 pb-1">{t('picked')}</div>}
              {lone.map((person, i) => (
                <PickRow key={person.Id} person={person} treeId={treeId} divided={i > 0} checked onClick={() => choose(person)} />
              ))}
              {related.map(g => {
                const open = g.people.filter(p => !isPicked(p.Id));
                return (
                  <React.Fragment key={g.key}>
                    <div className="flex items-baseline justify-between gap-2 px-4 pt-4 pb-1">
                      <span className="eyebrow">{g.label}</span>
                      {open.length > 1 && (
                        <button type="button" onClick={() => tickAll(open)}
                          className="relative text-sm font-medium text-text cursor-pointer before:absolute before:-inset-x-3 before:-inset-y-[13px] before:content-[''] focus-ring">
                          {t('tick_all')}
                        </button>
                      )}
                    </div>
                    {g.people.map((person, i) => (
                      <PickRow key={person.Id} person={person} treeId={treeId} divided={i > 0} checked={isPicked(person.Id)}
                        relation={person.relation} onClick={() => choose(person)} />
                    ))}
                  </React.Fragment>
                );
              })}
            </>
          );
        })()}
        {!typed && suggested && shown.length > 0 && <div className="eyebrow px-4 pt-4 pb-1">{suggested.label}</div>}
        {shown.map((person, i) => (
          <MobileRow
            key={person.Id}
            divided={i > 0 || (allowCreate && !(!typed && suggested))}
            checked={multiple ? isPicked(person.Id) : undefined}
            lead={
              <PersonAvatar
                as="span"
                mediaId={person.PrimaryMediaId}
                treeId={treeId}
                name={displayFullName(person) || tc('unknown')}
                initials={getInitials(person.FirstName, person.LastName)}
                sex={person.Sex}
                size={36}
                focalX={person.FocalX}
                focalY={person.FocalY}
                focalRadius={person.FocalRadius}
              />
            }
            label={<span className="serif text-md font-semibold">{displayFullName(person) || `(${tc('unknown')})`}</span>}
            sub={(person.BirthDate || person.DeathDate || person.ParentName1 || person.ParentName2 || person.PartnerName) ? <PersonSub person={person} /> : undefined}
            onClick={() => choose(person)}
          />
        ))}
        {typed.length >= MIN_QUERY && state === 'done' && shown.length === 0 && (
          <p className="m-0 px-4 py-4 text-base text-text-muted">{t('no_results', { query: typed })}</p>
        )}
        {typed.length >= MIN_QUERY && state === 'failed' && (
          <p className="m-0 px-4 py-4 text-base text-error">{t('search_failed')}</p>
        )}
        {typed.length > 0 && typed.length < MIN_QUERY && (
          <p className="m-0 px-4 py-4 text-base text-text-muted">{t('type_more')}</p>
        )}
      </div>
    </Sheet>
  );
}

/** A ticked person or one of their family, with the relation word before the dates. */
function PickRow({ person, treeId, divided, checked, relation, onClick }: {
  person: PersonResult; treeId?: number | null; divided: boolean; checked: boolean; relation?: string; onClick: () => void;
}) {
  const tc = useTranslations('common');
  return (
    <MobileRow
      divided={divided}
      checked={checked}
      lead={<PersonAvatar as="span" mediaId={person.PrimaryMediaId} treeId={treeId} name={displayFullName(person) || tc('unknown')}
        initials={getInitials(person.FirstName, person.LastName)} sex={person.Sex} size={36}
        focalX={person.FocalX} focalY={person.FocalY} focalRadius={person.FocalRadius} />}
      label={<span className="serif text-md font-semibold">{displayFullName(person) || `(${tc('unknown')})`}</span>}
      sub={<>{relation}{relation && (person.BirthDate || person.DeathDate) && ' · '}{(person.BirthDate || person.DeathDate) && <Lifespan birth={person.BirthDate} death={person.DeathDate} />}</>}
      onClick={onClick}
    />
  );
}

/** A result's second line: its dates, then how it already fits, which tells two Karls apart. */
function PersonSub({ person }: { person: PersonResult }) {
  const tc = useTranslations('common');
  const kin = personKin(person);
  const fit = kin ? tc(kin.kind === 'child' ? 'child_of' : 'partner_of', { names: kin.names }) : null;
  const dates = person.BirthDate || person.DeathDate ? <Lifespan birth={person.BirthDate} death={person.DeathDate} /> : null;
  return <>{dates}{dates && fit && ' · '}{fit}</>;
}

/** The short form as typed. */
export interface DraftFields {
  firstName: string;
  lastName: string;
  sex: '' | 'M' | 'F' | 'X';
  born: string;
}

export const EMPTY_DRAFT: DraftFields = { firstName: '', lastName: '', sex: '', born: '' };

/** The typed short form as a person to stage, or null when Born can't be read. */
export function toNewPerson(draft: DraftFields): NewPersonDraft | null {
  const born = draft.born.trim();
  const birthDate = born ? parseUserDateInput(born, slashOrder()) : null;
  if (born && !birthDate) return null;
  return { firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), sex: draft.sex || null, birthDate };
}

/** The short New person form: name, sex and born. Everything else waits for their page. */
export function ShortPersonForm({ value, onChange, bornError, hint }: {
  value: DraftFields;
  onChange: (next: DraftFields) => void;
  bornError: boolean;
  hint?: string;
}) {
  const t = useTranslations('personPicker');
  const field = 'w-full min-h-11 rounded-xl border border-border bg-surface px-3 text-md text-text placeholder:text-text-muted input-nozoom focus-ring';
  return (
    <>
      <fieldset className="grid gap-2.5 pb-1.5 m-0 border-0 p-0">
        <legend className="sr-only">{t('group_name')}</legend>
        <div className="eyebrow" aria-hidden="true">{t('group_name')}</div>
        <label className="grid gap-1.5">
          <span className="text-meta font-medium text-text-secondary">{t('first_name')}</span>
          <input className={field} value={value.firstName} placeholder={t('first_placeholder')} autoComplete="off"
            onChange={(e) => onChange({ ...value, firstName: e.target.value })} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-meta font-medium text-text-secondary">{t('last_name')}</span>
          <input className={field} value={value.lastName} placeholder={t('last_placeholder')} autoComplete="off"
            onChange={(e) => onChange({ ...value, lastName: e.target.value })} />
        </label>
      </fieldset>
      <fieldset className="grid gap-2.5 pt-4 mt-3 border-0 border-t border-border p-0 m-0">
        <legend className="sr-only">{t('group_about')}</legend>
        <div className="eyebrow" aria-hidden="true">{t('group_about')}</div>
        <div className="grid gap-1.5">
          <span className="text-meta font-medium text-text-secondary" aria-hidden="true">{t('sex')}</span>
          <SegmentedControl
            aria-label={t('sex')}
            fullWidth
            value={value.sex}
            onChange={(v) => onChange({ ...value, sex: v as DraftFields['sex'] })}
            options={[
              { v: '', l: t('sex_unknown') },
              { v: 'M', l: t('sex_male') },
              { v: 'F', l: t('sex_female') },
              { v: 'X', l: t('sex_nonbinary') },
            ]}
          />
        </div>
        <div className="grid gap-1.5">
          <label className="grid gap-1.5">
            <span className="text-meta font-medium text-text-secondary">{t('born')}</span>
            <input className={field} value={value.born} placeholder={t('born_placeholder')} autoComplete="off"
              aria-invalid={bornError || undefined} aria-describedby={bornError ? 'short-person-born-error' : undefined}
              onChange={(e) => onChange({ ...value, born: e.target.value })} />
          </label>
          {bornError && <span id="short-person-born-error" className="text-meta text-error">{t('born_invalid')}</span>}
        </div>
      </fieldset>
      {hint && <p className="m-0 mt-3 text-meta text-text-muted">{hint}</p>}
    </>
  );
}

/** Debounced tree search; drops answers to a query that is no longer typed. */
function usePeopleSearch(query: string, treeId?: number | null) {
  const [results, setResults] = useState<PersonResult[]>([]);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'failed'>('idle');
  const latest = useRef('');

  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (q.length < MIN_QUERY) return;
    const timer = setTimeout(async () => {
      setState('searching');
      try {
        const client = await getDataClient();
        const people = await client.people.search(q, treeId, RESULT_LIMIT) as PersonResult[];
        if (latest.current !== q) return;
        setResults(people);
        setState('done');
      } catch {
        if (latest.current !== q) return;
        setResults([]);
        setState('failed');
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, treeId]);

  return { results: query.trim().length >= MIN_QUERY ? results : [], state };
}

/** The user's slash-date order, as DateInput reads it. */
function slashOrder(): 'MDY' | 'DMY' {
  try {
    return localStorage.getItem('dateSlashFormat') === 'DMY' ? 'DMY' : 'MDY';
  } catch {
    return 'MDY';
  }
}
