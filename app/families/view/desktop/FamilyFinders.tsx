'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import { CHILD_RELATIONSHIP_TYPE_VALUES } from '@/lib/child-relationship';
import type { ChildRelationshipType } from '@/lib/data/types';
import { formatYearOrEmpty } from '@/lib/date-utils';
import type { PickedPerson } from '@/app/components/PersonPickerSheet';
import { useCachedResource } from '@/app/components/useCachedResource';
import { AddRow, EditorActions, PersonFinder, Select } from '@/app/components/ui';
import { escapeToCancel } from '@/app/hooks/useEditorFocusReturn';
import { peopleListKey } from '@/app/people/peopleListKey';
import { childWindow, likelyChildren, partnerSuggestions, type PoolPerson } from '@/app/families/new/mobile/model';
import { partnerShortName } from '../derive';
import type { Slot } from '../mobile/model';
import { pickedName } from '../pickedPeople';
import type { PartnerPerson } from '../useFamilyDetail';
import { draftFrom, type FamilyWrites } from './familyWrites';

type Trigger = Parameters<typeof PersonFinder>[0]['trigger'];

/**
 * The tree's people for the finders' suggestions: the people page's cached list,
 * fetched only once a finder has been opened, not on every family page view.
 */
function usePool(wanted: boolean, treeId: number | null): PoolPerson[] {
  const res = useCachedResource(wanted ? peopleListKey(treeId) : null, async () => {
    const client = await getDataClient();
    return client.people.list({ treeId });
  });
  return useMemo(() => (res.data?.people ?? []) as PoolPerson[], [res.data]);
}

/** Wraps a finder trigger so that opening it also starts loading the suggestions. */
function wanting(trigger: Trigger, want: () => void): Trigger {
  return (props) => trigger({ ...props, onClick: () => { want(); props.onClick(); } });
}

/**
 * Add partner (#119, G5): the finder popover on an empty partner slot, with
 * "Create …" first and people of about the other partner's age with no partner yet.
 * Picking writes at once; the toast offers Undo.
 */
export function PartnerFinder({ slot, other, takenIds, treeId, writes, trigger, align, className }: {
  slot: Slot;
  /** The partner already in the family, if any: the suggestions are their age. */
  other: PartnerPerson | null;
  takenIds: number[];
  treeId: number | null;
  writes: FamilyWrites;
  trigger: Trigger;
  align?: 'start' | 'end';
  className?: string;
}) {
  const tk = useTranslations('familyPhone');
  const tn = useTranslations('newFamilyDialog');
  const [wanted, setWanted] = useState(false);
  const pool = usePool(wanted, treeId);
  const suggestions = other ? partnerSuggestions(other, pool, takenIds) : [];
  return (
    <PersonFinder
      title={tk('add_partner')}
      treeId={treeId}
      excludeIds={takenIds}
      suggestions={suggestions.map((person) => ({ person, reason: person.BirthDate ? tn('born_year', { year: formatYearOrEmpty(person.BirthDate) }) : undefined }))}
      onPick={(person) => void writes.setPartner(slot, { kind: 'existing', person })}
      onCreate={(typed) => void writes.setPartner(slot, draftFrom(typed, ''))}
      align={align}
      className={className}
      trigger={wanting(trigger, () => setWanted(true))}
    />
  );
}

/**
 * Add child (#119, G4): the finder (several at once, "Create …" first, then likely
 * children), then a small panel to say how they're related to each partner before
 * they're added. Birth is preselected.
 */
export function AddChildFinder({ partner1, partner2, takenIds, treeId, writes }: {
  partner1: PartnerPerson | null;
  partner2: PartnerPerson | null;
  takenIds: number[];
  treeId: number | null;
  writes: FamilyWrites;
}) {
  const tf = useTranslations('editFamily');
  const tk = useTranslations('familyPhone');
  const tn = useTranslations('newFamilyDialog');
  const tc = useTranslations('common');
  const [wanted, setWanted] = useState(false);
  const [staged, setStaged] = useState<PickedPerson[] | null>(null);
  const [links, setLinks] = useState<{ partner1: ChildRelationshipType; partner2: ChildRelationshipType }>({ partner1: 'Birth', partner2: 'Birth' });
  const [busy, setBusy] = useState(false);
  // The panel takes focus when it opens in the finder's place, so Escape cancels it.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (staged) panelRef.current?.focus(); }, [staged]);
  const pool = usePool(wanted, treeId);
  const faces = [partner1, partner2].filter((p): p is PartnerPerson => p != null);
  const span = childWindow(faces);
  const likely = likelyChildren(faces, pool, takenIds);
  const both = partner1 != null && partner2 != null;
  const slots: Slot[] = both ? ['partner1', 'partner2'] : partner2 && !partner1 ? ['partner2'] : faces.length ? ['partner1'] : [];

  const stage = (picked: PickedPerson[]) => { setLinks({ partner1: 'Birth', partner2: 'Birth' }); setStaged(picked); };

  async function save() {
    if (!staged || busy) return;
    setBusy(true);
    // One partner: one choice, written to both slots so it reads the same if a partner is added.
    const relationship = both ? links : slots[0] ? links[slots[0]] : 'Birth';
    const ok = await writes.addChildren(staged, relationship);
    setBusy(false);
    if (ok) setStaged(null);
  }

  if (staged) {
    const unknown = tc('unknown');
    const names = staged.map((p) => pickedName(p, unknown)).join(', ');
    return (
      <div ref={panelRef} tabIndex={-1} className="inline-panel flex flex-col gap-3 mt-2 outline-none" role="group" aria-label={tf('add_child')} onKeyDown={escapeToCancel(() => setStaged(null))}>
        <p className="m-0 text-sm text-text">{names}</p>
        {slots.map((slot) => (
          <Select
            key={slot}
            className="self-start"
            label={both ? tf('relationship_to', { name: partnerShortName(slot === 'partner1' ? partner1 : partner2) || unknown }) : tf('relationship_type')}
            valueLabel={tf(`rel_${links[slot].toLowerCase()}`)}
            options={CHILD_RELATIONSHIP_TYPE_VALUES.map((rt) => ({ key: rt, value: rt, label: tf(`rel_${rt.toLowerCase()}`) }))}
            isSelected={(v) => v === links[slot]}
            onSelect={(v) => setLinks((l) => (both ? { ...l, [slot]: v } : { partner1: v, partner2: v }))}
          />
        ))}
        <EditorActions size="sm" saving={busy} onSave={() => void save()} onCancel={() => setStaged(null)}
          saveLabel={tn('add_n_children', { count: staged.length })} />
      </div>
    );
  }

  const lastName = partner1?.LastName ?? partner2?.LastName ?? '';
  const reason = span ? tn('likely_reason', { from: span.from, to: span.to }) : undefined;
  return (
    <PersonFinder
      multiple
      title={tk('add_child')}
      treeId={treeId}
      excludeIds={takenIds}
      suggestions={likely.map((person) => ({ person, reason }))}
      onPickMany={(people) => stage(people.map((person) => ({ kind: 'existing', person })))}
      onCreate={(typed) => stage([draftFrom(typed, lastName)])}
      addManyLabel={(count) => tn('add_n_children', { count })}
      align="end"
      trigger={wanting((p) => (
        <div className="ledger-foot ledger-foot--plain"><AddRow {...p} label={tf('add_child')} /></div>
      ), () => setWanted(true))}
    />
  );
}

