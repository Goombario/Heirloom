'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Person, PersonResult, PersonWithRelations } from '@/lib/db/schema';
import type { ChildRelationshipType } from '@/lib/data/types';
import { getDataClient } from '@/lib/data';
import { formatYearOrEmpty } from '@/lib/date-utils';
import { displayFullName } from '@/lib/utils/names';
import DateInput from '@/app/components/DateInput';
import type { PickedPerson } from '@/app/components/PersonPickerSheet';
import { useCachedResource } from '@/app/components/useCachedResource';
import { InlinePanel, Lifespan, PersonFinder, SegmentedControl, SelectField, fieldClass } from '@/app/components/ui';
import { peopleListKey } from '../../peopleListKey';
import { nameBarParts } from '../mobile/model';
import {
  CHILD_TYPES, FAMILY_ROLES, PARTNERSHIP_TYPES, childFamilyOptions, linkPlan, linkedIds, parentFamilyOptions, siblingFamilyOptions, suggestRelatives,
  type FamilyRole, type LinkChoice,
} from '../mobile/familyLinks';
import { runLinkPlan } from '../mobile/runLinkPlan';
import type { RunChange } from '../mobile/useChange';

const NEW = 'new';

/**
 * Add family in the desktop person rail (#49), the phone's flow in place: Parent,
 * Partner, Child or Sibling each open the person finder (suggestions first, or
 * "Create …"), then one panel says what will happen and asks the one thing that
 * matters for the role. Add writes the phone's link plan (`linkPlan`), with Undo.
 */
export function AddFamilyPanel({ person, treeId, canUndo, run, onClose }: {
  person: PersonWithRelations;
  treeId: number | null;
  canUndo: boolean;
  run: RunChange;
  onClose: () => void;
}) {
  const t = useTranslations('mobileFamily');
  const tp = useTranslations('mobileProfile');
  const tc = useTranslations('common');
  const ids = useId();
  const [step, setStep] = useState<{ role: FamilyRole; picked: PickedPerson } | null>(null);
  const [choice, setChoice] = useState<LinkChoice>({ familyId: null });
  const [sex, setSex] = useState('');
  const [busy, setBusy] = useState(false);
  const name = nameBarParts(person).given || t('this_person');

  // Suggestions come from the tree's people list, the people page's own cached copy.
  const pool = useCachedResource(peopleListKey(treeId), async () => {
    const client = await getDataClient();
    return client.people.list({ treeId });
  });
  const candidates: PersonResult[] = (pool.data?.people ?? []).map((p) => ({
    Id: p.Id, FirstName: p.FirstName, LastName: p.LastName, Sex: p.Sex, BirthDate: p.BirthDate, DeathDate: p.DeathDate,
    PrimaryMediaId: p.PrimaryMediaId, FocalX: p.FocalX, FocalY: p.FocalY, FocalRadius: p.FocalRadius,
    ParentName1: p.FatherName ?? null, ParentName2: p.MotherName ?? null,
  }));

  const begin = (role: FamilyRole, picked: PickedPerson) => {
    const first = role === 'parent' ? parentFamilyOptions(person)[0]
      : role === 'child' ? childFamilyOptions(person)[0]
        : role === 'sibling' ? siblingFamilyOptions(person)[0] : undefined;
    setChoice({
      familyId: first?.familyId ?? null,
      slot: role === 'parent' ? parentFamilyOptions(person)[0]?.slot : role === 'child' ? childFamilyOptions(person)[0]?.slot : undefined,
      childType: 'Birth',
      familyType: 'Marriage',
      startDate: null,
    });
    setSex('');
    setStep({ role, picked });
  };
  const createFrom = (role: FamilyRole) => (typed: string) => {
    const words = typed.trim().split(/\s+/).filter(Boolean);
    begin(role, { kind: 'new', draft: {
      firstName: words[0] ?? '',
      lastName: words.length > 1 ? words.slice(1).join(' ') : role === 'partner' ? '' : person.LastName ?? '',
      sex: null,
      birthDate: null,
    } });
  };

  if (!step) {
    return (
      <div className="inline-panel flex flex-col gap-3" role="group" aria-label={t('add_family')}>
        <p className="m-0 text-sm text-text-secondary">{t('who_adding', { name })}</p>
        <div className="flex flex-wrap gap-2">
          {FAMILY_ROLES.map((role) => {
            // The finder heads these "Suggested"; each row's dates say the rest.
            const s = suggestRelatives(role, person, candidates, 5);
            return (
              <PersonFinder
                key={role}
                title={t(`title_${role}`)}
                treeId={treeId}
                excludeIds={linkedIds(person)}
                suggestions={s.people.map((p) => ({ person: p }))}
                // The rail sits at the page's right edge: open leftwards.
                align="end"
                onCreate={createFrom(role)}
                onPick={(p) => begin(role, { kind: 'existing', person: p })}
                trigger={(props) => (
                  <button
                    type="button"
                    {...props}
                    className="inline-flex items-center h-8 px-3 rounded-full border border-border bg-card text-sm font-medium text-text cursor-pointer hover:bg-hover-surface focus-ring"
                  >
                    {t(`role_${role}`)}
                  </button>
                )}
              />
            );
          })}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="h-8 px-3 rounded-btn border-0 bg-transparent text-sm font-medium text-text-secondary cursor-pointer hover:bg-hover-surface focus-ring">
            {tc('cancel')}
          </button>
        </div>
      </div>
    );
  }

  const { role, picked } = step;
  const pickedName = picked.kind === 'existing'
    ? displayFullName(picked.person) || t('unknown')
    : [picked.draft.firstName, picked.draft.lastName].filter(Boolean).join(' ') || t('unknown');
  const pickedSex = (picked.kind === 'existing' ? picked.person.Sex : sex) || 'U';
  const married = choice.familyType === 'Marriage' ? 'yes' : 'no';
  const set = (patch: Partial<LinkChoice>) => setChoice((c) => ({ ...c, ...patch }));
  const first = (p: Person | null | undefined) => (p ? p.FirstName?.trim().split(/\s+/)[0] || displayFullName(p) || t('unknown') : t('unknown'));
  const familyValue = choice.familyId == null ? NEW : String(choice.familyId);
  const toFamily = (v: string) => (v === NEW ? null : Number(v));

  async function add() {
    if (busy) return;
    const plan = linkPlan(role, person.Id, choice);
    const who: PickedPerson = picked.kind === 'new' ? { kind: 'new', draft: { ...picked.draft, sex: sex || null } } : picked;
    setBusy(true);
    const ok = await run(
      async () => runLinkPlan({ client: await getDataClient(), plan, picked: who, treeId, canUndo }),
      { message: t(`added_${role}`, { name: pickedName, of: name, sex: pickedSex, married }) },
    );
    setBusy(false);
    if (ok) onClose();
  }

  const field = (label: string, control: (id: string) => React.ReactNode, key: string) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${ids}-${key}`} className="text-meta font-medium text-text-secondary">{label}</label>
      {control(`${ids}-${key}`)}
    </div>
  );

  // A segmented control names itself (aria-label); the caption is for the eye.
  const group = (label: string, control: React.ReactNode) => (
    <div className="flex flex-col gap-1">
      <span aria-hidden="true" className="text-meta font-medium text-text-secondary">{label}</span>
      {control}
    </div>
  );

  return (
    <InlinePanel
      label={t(`title_${role}`)}
      onSave={add}
      onCancel={onClose}
      saving={busy}
      saveLabel={t('add')}
      dirty={picked.kind === 'new'}
    >
      <p className="m-0 text-base leading-normal text-text-secondary">
        {t.rich(`becomes_${role}`, {
          name: pickedName, of: name, sex: pickedSex, married,
          b: (chunks) => <b className="font-semibold text-text">{chunks}</b>,
          meta: () => picked.kind === 'existing'
            ? (picked.person.BirthDate || picked.person.DeathDate ? <> (<Lifespan birth={picked.person.BirthDate} death={picked.person.DeathDate} />)</> : null)
            : <> ({t('new_person')})</>,
        })}
      </p>

      {picked.kind === 'new' && group(tp('field_sex'), (
        <SegmentedControl aria-label={tp('field_sex')} value={sex} onChange={setSex} options={[
          { v: 'F', l: tp('sex_female') }, { v: 'M', l: tp('sex_male') },
          { v: 'X', l: tp('sex_nonbinary') }, { v: '', l: tp('sex_unknown') },
        ]} />
      ))}

      {role === 'partner' && (
        <>
          {field(t('partnership'), (id) => (
            <SelectField id={id} value={choice.familyType ?? 'Marriage'} onChange={(v) => set({ familyType: v })}
              options={PARTNERSHIP_TYPES.map((x) => ({ value: x.v, label: t(`ftype_${x.key}`) }))} />
          ), 'type')}
          {field(married === 'yes' ? t('married') : t('started'), (id) => (
            <DateInput id={id} value={choice.startDate ?? ''} onChange={(startDate) => set({ startDate: startDate || null })} className={fieldClass()} />
          ), 'start')}
        </>
      )}

      {role === 'parent' && field(t('birth_family', { name }), (id) => (
        <SelectField id={id} value={familyValue}
          onChange={(v) => { const familyId = toFamily(v); set({ familyId, slot: parentFamilyOptions(person).find((o) => o.familyId === familyId)?.slot }); }}
          options={[
            ...parentFamilyOptions(person).map((o) => ({
              value: String(o.familyId),
              label: o.parent ? t('parent_family_sub', { parent: first(o.parent), name }) : t('family_no_parents'),
            })),
            { value: NEW, label: t('new_family_parent_sub', { name }) },
          ]} />
      ), 'family')}

      {role === 'child' && (
        <>
          {field(t('which_family'), (id) => (
            <SelectField id={id} value={familyValue}
              onChange={(v) => { const familyId = toFamily(v); set({ familyId, slot: childFamilyOptions(person).find((o) => o.familyId === familyId)?.slot }); }}
              options={[
                ...childFamilyOptions(person).map((o) => ({
                  value: String(o.familyId),
                  label: [o.partner ? t('with_partner', { name: first(o.partner) }) : t('only', { name }),
                    o.marriageDate ? t('married_children', { year: formatYearOrEmpty(o.marriageDate), count: o.childCount }) : t('children_count', { count: o.childCount })].join(' · '),
                })),
                // One family with the other parent unknown is enough.
                ...(childFamilyOptions(person).some((o) => !o.partner) ? [] : [{ value: NEW, label: `${t('only', { name })} · ${t('only_new_sub')}` }]),
              ]} />
          ), 'family')}
          {group(t('relationship'), (
            <SegmentedControl aria-label={t('relationship')} value={choice.childType ?? 'Birth'}
              onChange={(v) => set({ childType: v as ChildRelationshipType })}
              options={CHILD_TYPES.map((v) => ({ v, l: t(`child_type_${v}`) }))} />
          ))}
        </>
      )}

      {role === 'sibling' && (
        <>
          {field(t('which_family'), (id) => (
            <SelectField id={id} value={familyValue} onChange={(v) => set({ familyId: toFamily(v) })}
              options={siblingFamilyOptions(person).length > 0
                ? siblingFamilyOptions(person).map((o) => ({
                  value: String(o.familyId),
                  label: `${o.parents.length > 0 ? t('children_of', { names: o.parents.map(first).join(' & ') }) : t('parents_unknown')} · ${t('children_count', { count: o.childCount })}`,
                }))
                : [{ value: NEW, label: t('new_family_sibling_sub', { name }) }]} />
          ), 'family')}
          <p className="m-0 text-meta text-text-muted">{t('sibling_kind_hint')}</p>
        </>
      )}
    </InlinePanel>
  );
}
