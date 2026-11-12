'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PersonWithRelations } from '@/lib/db/schema';
import { getDataClient } from '@/lib/data';
import { formatDateForDisplay } from '@/lib/date-utils';
import { livingStatus } from '@/lib/living';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { DEATH_DETAILS_CLEARED } from '@/app/components/person-form/vitalEvent';
import { ActionLink, Button, FieldColumn, FieldColumns, FormBlock, FormDialog, Input, SegmentedControl, WarningLine } from '@/app/components/ui';
import { hasDeathFact } from '../derive';
import { nameBarParts } from '../mobile/model';
import type { LivingChoice } from '../mobile/panes';
import type { RunChange } from '../mobile/useChange';

const SEXES = ['F', 'M', 'X', ''] as const;
type Sex = (typeof SEXES)[number];
const asSex = (v: string | null | undefined): Sex => ((SEXES as readonly string[]).includes(v ?? '') ? (v ?? '') as Sex : '');

/**
 * Edit person on the desktop page (#49): the record name (first and last, either is
 * enough), sex and living status. Birth and death are edited on their timeline rows,
 * so here they are read-only lines with "Edit in timeline ›" (supersedes the #795
 * hero editor). With a death recorded, Living or Unknown asks whether to delete it.
 */
export function EditPersonDialog({ open, onClose, person, treeId, language, run, onEditVital }: {
  open: boolean;
  onClose: () => void;
  person: PersonWithRelations;
  treeId: number | null;
  language: string;
  run: RunChange;
  /** Close the dialog and go to that row on the timeline. */
  onEditVital: (which: 'birth' | 'death') => void;
}) {
  // A fresh draft each time it opens.
  const [opened, setOpened] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); if (open) setOpened((n) => n + 1); }
  return <Body key={opened} open={open} onClose={onClose} person={person} treeId={treeId} language={language} run={run} onEditVital={onEditVital} />;
}

function Body({ open, onClose, person, treeId, language, run, onEditVital }: Parameters<typeof EditPersonDialog>[0]) {
  const t = useTranslations('personDesktop');
  const tp = useTranslations('mobileProfile');
  const te = useTranslations('mobileEvents');
  const tm = useTranslations('mobilePerson');
  const tc = useTranslations('common');
  const words = useDateQualifierWords();
  const saved = { first: person.FirstName ?? '', last: person.LastName ?? '', sex: asSex(person.Sex), status: livingStatus(person) as LivingChoice };
  const [draft, setDraft] = useState(saved);
  // Living or Unknown with a death recorded: null until the person answers.
  const [dropDeath, setDropDeath] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const hasDeath = hasDeathFact(person);
  const asking = hasDeath && draft.status !== 'deceased' && dropDeath == null;
  const dirty = draft.first.trim() !== saved.first.trim() || draft.last.trim() !== saved.last.trim()
    || draft.sex !== saved.sex || draft.status !== saved.status;
  const noName = !draft.first.trim() && !draft.last.trim();
  const sex = { sex: draft.sex || 'U' };
  const date = (d: string | null | undefined) => (d ? formatDateForDisplay(d, language, words) : '');
  const line = (d: string | null | undefined, place: string | null | undefined) =>
    [date(d), place].filter(Boolean).join(' · ') || tm('not_recorded');
  const deathWhen = [date(person.DeathDate), person.DeathPlace?.split(',')[0]?.trim()].filter(Boolean).join(' · ');
  const given = nameBarParts(person).given || tp('this_person');

  const setStatus = (v: string) => {
    setDraft((d) => ({ ...d, status: v as LivingChoice }));
    setDropDeath(null);
  };

  const save = async () => {
    if (saving || noName || asking) return;
    setSaving(true);
    const statusChanged = draft.status !== saved.status;
    const IsDeceased = draft.status === 'living' ? 0 : draft.status === 'deceased' ? 1 : null;
    const clear = statusChanged && hasDeath && draft.status !== 'deceased' && dropDeath === true;
    const message = clear
      ? te(draft.status === 'living' ? 'death_deleted_living' : 'death_deleted_unknown')
      : tp('person_saved');
    const ok = await run(async () => {
      const client = await getDataClient();
      return client.people.update(person.Id, {
        FirstName: draft.first.trim() || null,
        LastName: draft.last.trim() || null,
        Sex: draft.sex || null,
        // Keeping the death keeps the person deceased: a recorded death outranks the flag (#895).
        ...(statusChanged && !(hasDeath && dropDeath === false) ? { IsDeceased } : {}),
        ...(clear ? DEATH_DETAILS_CLEARED : {}),
      }, treeId);
    }, { message, detail: clear ? deathWhen || undefined : undefined });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={tp('edit_person')}
      dirty={dirty}
      busy={saving}
      footer={(requestClose) => (
        <>
          <Button variant="outline" onClick={requestClose} disabled={saving}>{tc('cancel')}</Button>
          <Button variant="primary" onClick={save} disabled={saving || noName || asking}>{tc('save')}</Button>
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <FormBlock title={tp('group_name')} className="!pt-0">
          <FieldColumns>
            <Input label={tp('first_name')} value={draft.first} maxLength={200} autoComplete="off"
              placeholder={tp('first_name_placeholder')} onChange={(e) => setDraft((d) => ({ ...d, first: e.target.value }))} />
            <Input label={tp('last_name')} value={draft.last} maxLength={200} autoComplete="off"
              placeholder={tp('last_name_placeholder')} onChange={(e) => setDraft((d) => ({ ...d, last: e.target.value }))} />
          </FieldColumns>
          <p className="m-0 text-meta text-text-muted">{noName ? t('name_needed') : t('name_hint')}</p>
        </FormBlock>
        <FormBlock title={tp('field_sex')}>
          <SegmentedControl
            aria-label={tp('field_sex')}
            value={draft.sex}
            onChange={(v) => setDraft((d) => ({ ...d, sex: asSex(v) }))}
            options={[
              { v: 'F', l: tp('sex_female') }, { v: 'M', l: tp('sex_male') },
              { v: 'X', l: tp('sex_nonbinary') }, { v: '', l: tp('sex_unknown') },
            ]}
          />
        </FormBlock>
        <FormBlock title={tm('row_status')}>
          <SegmentedControl
            aria-label={te('status_label')}
            value={draft.status}
            onChange={setStatus}
            options={[{ v: 'unknown', l: tm('unknown') }, { v: 'living', l: tm('living', sex) }, { v: 'deceased', l: tm('deceased', sex) }]}
          />
          {hasDeath && draft.status !== 'deceased' && (
            <div className="grid gap-2">
              <WarningLine>
                {te('status_confirm_title', { name: given })}. {te(draft.status === 'living' ? 'status_confirm_living' : 'status_confirm_unknown', { what: deathWhen || te('death_no_details') })}
              </WarningLine>
              <div className="flex flex-wrap gap-2" role="group" aria-label={te('status_confirm_title', { name: given })}>
                <Button size="sm" variant={dropDeath === true ? 'danger' : 'outline'} aria-pressed={dropDeath === true} onClick={() => setDropDeath(true)}>
                  {te(draft.status === 'living' ? 'status_confirm_pill_living' : 'status_confirm_pill_unknown')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setDropDeath(null); setDraft((d) => ({ ...d, status: 'deceased' })); }}>
                  {te('keep_death')}
                </Button>
              </div>
              {dropDeath === true && <p className="m-0 text-meta text-text-muted">{t('death_will_go')}</p>}
            </div>
          )}
        </FormBlock>
        <FormBlock title={t('vitals')}>
          <FieldColumns>
            <FieldColumn title={tm('born')} action={<ActionLink onClick={() => onEditVital('birth')}>{t('edit_in_timeline')}</ActionLink>}>
              <p className="m-0 text-base text-text">{line(person.BirthDate, person.BirthPlace)}</p>
            </FieldColumn>
            <FieldColumn title={tm('died')} action={hasDeath ? <ActionLink onClick={() => onEditVital('death')}>{t('edit_in_timeline')}</ActionLink> : undefined}>
              <p className="m-0 text-base text-text">{hasDeath ? line(person.DeathDate, person.DeathPlace) : tm('not_recorded')}</p>
            </FieldColumn>
          </FieldColumns>
        </FormBlock>
      </form>
    </FormDialog>
  );
}
