'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { QualifierAliases, DateQualifierWords } from '@/lib/date-qualifiers';

/**
 * Alias lists are one comma-separated string per qualifier in messages/*.json, so
 * translators own the vocabulary of their own language and i18n-messages.test.ts
 * covers key drift for free.
 */
export function parseAliasList(raw: string): string[] {
    return raw
        .split(',')
        .map((a) => a.trim().toLowerCase().replace(/\.$/, ''))
        .filter(Boolean);
}

/** The current language's qualifier aliases, as `hoistQualifier` wants them. */
export function useQualifierAliases(): QualifierAliases {
    const t = useTranslations('dateInput');
    const abt = t('alias_abt');
    const bef = t('alias_bef');
    const aft = t('alias_aft');
    return useMemo(
        () => ({ ABT: parseAliasList(abt), BEF: parseAliasList(bef), AFT: parseAliasList(aft) }),
        [abt, bef, aft],
    );
}

/**
 * The current language's qualifier display words, for `formatDateForDisplay`.
 * Memoised on the ten translated strings so the object identity is stable per
 * language — call sites put it in hook dependency arrays.
 */
export function useDateQualifierWords(): DateQualifierWords {
    const t = useTranslations('dateInput');
    const abt = t('word_abt');
    const est = t('word_est');
    const cal = t('word_cal');
    const int = t('word_int');
    const bef = t('word_bef');
    const aft = t('word_aft');
    const bet = t('word_bet');
    const and = t('word_and');
    const from = t('word_from');
    const to = t('word_to');
    return useMemo(
        () => ({ ABT: abt, EST: est, CAL: cal, INT: int, BEF: bef, AFT: aft, BET: bet, AND: and, FROM: from, TO: to }),
        [abt, est, cal, int, bef, aft, bet, and, from, to],
    );
}
