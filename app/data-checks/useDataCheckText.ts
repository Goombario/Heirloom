'use client';

import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { DataCheckRuleId } from '@/lib/data-checks/rules';
import type { DataCheckEntry } from '@/lib/data/types';
import { messageArgs, ruleArgs, type DataCheckPeople, peopleById } from './model';

/**
 * A rule's three messages (#831): its name, the one-line list summary and the
 * detail's sentence. Each is one ICU message per locale, with a `select` on
 * sex and a `plural` on counts. Shared by the Data checks page, the home card
 * (#834) and the inline marks (#833).
 */
export function useDataCheckText(people: DataCheckPeople) {
    const t = useTranslations('dataChecks');
    const tCommon = useTranslations('common');
    const byId = useMemo(() => peopleById(people), [people]);
    const unknown = tCommon('unknown');

    const ruleName = useCallback((rule: DataCheckRuleId) => t(`rule_${rule}`, ruleArgs(rule)), [t]);
    const summary = useCallback(
        (p: DataCheckEntry) => t(`summary_${p.rule}`, messageArgs(p, byId, unknown)),
        [t, byId, unknown],
    );
    const sentence = useCallback(
        (p: DataCheckEntry) => t(`sentence_${p.rule}`, messageArgs(p, byId, unknown)),
        [t, byId, unknown],
    );
    return { byId, unknown, ruleName, summary, sentence };
}
