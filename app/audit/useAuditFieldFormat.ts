'use client';

import { useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatDateForDisplay } from '@/lib/date-utils';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { auditFieldSpec, type AuditFieldSpec } from '@/lib/utils/audit-fields';
import type { AuditListResult } from '@/lib/data/types';

type Refs = AuditListResult['refs'];

export const EMPTY_AUDIT_REFS: Refs = { people: {}, families: {} };

/**
 * Translated labels and readable values for audit change details (#551): field
 * names instead of columns, localized dates and codes, and people and families
 * by name. `refs` comes from the audit list.
 */
export function useAuditFieldFormat(refs: Refs = EMPTY_AUDIT_REFS) {
    const t = useTranslations('audit');
    const tCommon = useTranslations('common');
    const tCases = useTranslations('cases');
    const tFamilies = useTranslations('families');
    const tEditFamily = useTranslations('editFamily');
    const tEventTypes = useTranslations('eventTypes');
    const locale = useLocale();
    const dateWords = useDateQualifierWords();

    const label = useCallback((s: AuditFieldSpec) => t(`field_${s.label}`), [t]);

    const value = useCallback((s: AuditFieldSpec, raw: unknown): string => {
        if (raw == null || raw === '') return tCommon('empty_value');
        const text = Array.isArray(raw) ? raw.join(', ') : String(raw);
        switch (s.kind) {
            case 'date':
                return formatDateForDisplay(text, locale, dateWords) || text;
            case 'person':
                return refs.people[text] ?? t('ref_person_missing', { id: text });
            case 'family':
                return refs.families[text] ?? t('ref_family_missing', { id: text });
            case 'sex':
                return text === 'M' ? tCommon('male') : text === 'F' ? tCommon('female') : tCommon('unknown_sex');
            case 'flag':
                return raw === true || text === '1' || text === 'true' ? t('value_yes') : t('value_no');
            case 'caseStatus':
                return tCases.has(`status_${text}`) ? tCases(`status_${text}`) : text;
            case 'childType': {
                const key = `rel_${text.toLowerCase()}`;
                return tEditFamily.has(key) ? tEditFamily(key) : text;
            }
            case 'familyType': {
                const key = { Marriage: 'ftype_marriage', 'Civil union': 'ftype_civil_union', 'Common-law': 'ftype_commonlaw', Other: 'ftype_other' }[text];
                return key ? tFamilies(key) : text;
            }
            case 'eventType':
                return tEventTypes.has(text) ? tEventTypes(text) : text;
            case 'coords': {
                if (!Array.isArray(raw) || raw.length !== 2) return text;
                const n = new Intl.NumberFormat(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
                return raw.map((v) => n.format(Number(v))).join(', ');
            }
            case 'opaque':
                return t('value_changed');
            default:
                return text;
        }
    }, [t, tCommon, tCases, tFamilies, tEditFamily, tEventTypes, locale, dateWords, refs]);

    return { spec: auditFieldSpec, label, value };
}
