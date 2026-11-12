'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { CHILD_RELATIONSHIP_TYPE_VALUES, type ChildRelationships, type ChildRelationshipType } from '@/lib/child-relationship';
import { FieldLabel } from './FormField';
import { SelectField } from './Select';
import { cx } from './cx';

export interface ParentRelationshipSelectsProps {
  value: ChildRelationships;
  onChange: (value: ChildRelationships) => void;
  /**
   * The partners' short names. A missing partner gets no select: with one partner
   * there is one select and it sets both slots, so a one-parent family always
   * stores one value (ADR 0027).
   */
  partner1Name?: string | null;
  partner2Name?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * The per-parent relationship choice (ADR 0027, #55): one select for each partner,
 * in the stored vocabulary (Birth, Adoption, Foster, Step, Guardian, Unknown). Both
 * quick-add forms, the family page's child Edit panel and its Add child confirm use it.
 */
export function ParentRelationshipSelects({ value, onChange, partner1Name, partner2Name, size = 'sm', className }: ParentRelationshipSelectsProps) {
  const t = useTranslations('editFamily');
  const id = useId();
  const options = CHILD_RELATIONSHIP_TYPE_VALUES.map((rt) => ({ value: rt, label: t(`rel_${rt.toLowerCase()}` as 'rel_birth') }));
  const has1 = partner1Name != null;
  const has2 = partner2Name != null;
  const both = has1 && has2;

  const slots: Array<{ slot: keyof ChildRelationships; name: string | null }> = both
    ? [{ slot: 'partner1', name: partner1Name }, { slot: 'partner2', name: partner2Name }]
    : [{ slot: has2 ? 'partner2' : 'partner1', name: has2 ? partner2Name : partner1Name ?? null }];

  const set = (slot: keyof ChildRelationships, v: ChildRelationshipType) =>
    onChange(both ? { ...value, [slot]: v } : { partner1: v, partner2: v });

  return (
    <div className={cx('flex flex-wrap gap-3', className)}>
      {slots.map(({ slot, name }) => (
        <div key={slot} className="min-w-[180px] flex-[1_1_180px]">
          <FieldLabel
            htmlFor={`${id}-${slot}`}
            label={both || name ? t('relationship_to', { name: name || t('rel_unknown') }) : t('relationship_type')}
          >
            <SelectField id={`${id}-${slot}`} size={size} value={value[slot]} onChange={(v) => set(slot, v)} options={options} />
          </FieldLabel>
        </div>
      ))}
    </div>
  );
}
