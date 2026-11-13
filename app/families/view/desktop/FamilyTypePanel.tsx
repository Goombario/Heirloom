'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FamilyType } from '@/lib/db/schema';
import { FieldLabel, HeroEditorPanel, SegmentedControl } from '@/app/components/ui';

const TYPES: FamilyType[] = ['Marriage', 'Civil union', 'Common-law', 'Other', 'Unknown'];

/**
 * ⋯ › Edit family (#119, G6): the family's type, and only that. When and where it
 * started is edited on the Marriage row, the partners in the rail, and how it ended
 * on the timeline.
 */
export function FamilyTypePanel({ type, onSave, onCancel }: {
  type: FamilyType;
  onSave: (type: FamilyType) => Promise<boolean>;
  onCancel: () => void;
}) {
  const t = useTranslations('editFamily');
  const tk = useTranslations('familyPhone');
  const tc = useTranslations('common');
  const [value, setValue] = useState<FamilyType>(type);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (value === type) { onCancel(); return; }
    setSaving(true);
    const ok = await onSave(value);
    setSaving(false);
    if (ok) onCancel();
  }

  return (
    <HeroEditorPanel onSave={() => void save()} onCancel={onCancel} saving={saving} dirty={value !== type}>
      <FieldLabel label={t('type_label')} hint={tk('type_hint')}>
        <SegmentedControl
          value={value}
          onChange={(v) => setValue(v as FamilyType)}
          aria-label={t('type_label')}
          className="self-start"
          options={TYPES.map((v) => ({
            v,
            l: v === 'Unknown' ? tc('unknown') : t(`type_${v === 'Civil union' ? 'civil_union' : v === 'Common-law' ? 'common_law' : v.toLowerCase()}` as 'type_marriage'),
          }))}
        />
      </FieldLabel>
    </HeroEditorPanel>
  );
}
