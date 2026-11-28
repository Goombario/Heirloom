'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ActionLink, Input, cx, fieldClass } from '@/app/components/ui';

/** The three name parts a person editor drafts (#37, ADR 0053). */
export interface NamePartsDraft { prefix: string; before: string; suffix: string }

export const namePartsDraft = (p: { NamePrefix?: string | null; SurnamePrefix?: string | null; NameSuffix?: string | null }): NamePartsDraft =>
    ({ prefix: p.NamePrefix ?? '', before: p.SurnamePrefix ?? '', suffix: p.NameSuffix ?? '' });

export const namePartsChanged = (a: NamePartsDraft, b: NamePartsDraft): boolean =>
    a.prefix.trim() !== b.prefix.trim() || a.before.trim() !== b.before.trim() || a.suffix.trim() !== b.suffix.trim();

/** The update body for the parts: an emptied field clears its column. */
export const namePartsBody = (d: NamePartsDraft) =>
    ({ NamePrefix: d.prefix.trim() || null, SurnamePrefix: d.before.trim() || null, NameSuffix: d.suffix.trim() || null });

/**
 * "More name parts" under the first and last name (#37, layout A2): a link at the
 * left edge that opens one row of Prefix, Before last name and Suffix. It starts
 * open when any part has a value. On the phone the three fields stack.
 */
export function NamePartsFields({ value, onChange, phone = false }: {
    value: NamePartsDraft;
    onChange: (next: NamePartsDraft) => void;
    phone?: boolean;
}) {
    const t = useTranslations('mobileProfile');
    const ids = useId();
    const [open, setOpen] = useState(() => Boolean(value.prefix || value.before || value.suffix));
    const fields = [
        { key: 'prefix', label: t('name_prefix'), placeholder: t('name_prefix_placeholder') },
        { key: 'before', label: t('name_before_last'), placeholder: t('name_before_last_placeholder') },
        { key: 'suffix', label: t('name_suffix'), placeholder: t('name_suffix_placeholder') },
    ] as const;
    const set = (key: keyof NamePartsDraft, v: string) => onChange({ ...value, [key]: v });

    return (
        <div className="grid gap-2">
            <div>
                <ActionLink kind="expand" expanded={open} controls={`${ids}-parts`} onClick={() => setOpen((o) => !o)} className={phone ? 'min-h-11' : undefined}>
                    {t('more_name_parts')}
                </ActionLink>
            </div>
            {open && (
                <div id={`${ids}-parts`} className={cx('grid gap-3', !phone && 'grid-cols-3')}>
                    {fields.map((f) => phone ? (
                        <div key={f.key} className="grid gap-1.5">
                            <label htmlFor={`${ids}-${f.key}`} className="text-meta font-medium text-text-secondary">{f.label}</label>
                            <input id={`${ids}-${f.key}`} type="text" value={value[f.key]} maxLength={100} autoComplete="off"
                                autoCapitalize="words" enterKeyHint="next" placeholder={f.placeholder}
                                onChange={(e) => set(f.key, e.target.value)}
                                className={cx(fieldClass(), 'min-h-11')} />
                        </div>
                    ) : (
                        <Input key={f.key} size="sm" label={f.label} value={value[f.key]} maxLength={100} autoComplete="off"
                            placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
                    ))}
                </div>
            )}
        </div>
    );
}
