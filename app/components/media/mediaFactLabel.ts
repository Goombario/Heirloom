import type { useTranslations } from 'next-intl';
import type { MediaOwnerFact } from '@/lib/db/fact-tables';

/**
 * A fact-scoped photo's label in its owner's list (ADR 0030), from the `ownerMedia`
 * messages. There is no control that changes the fact; this only names it.
 */
export function mediaFactLabel(t: ReturnType<typeof useTranslations<'ownerMedia'>>, facts: readonly MediaOwnerFact[] | undefined): string | null {
    if (!facts || facts.length === 0) return null;
    return facts.map((fact) => {
        switch (fact) {
            case 'Birth': return t('fact_birth');
            case 'Death': return t('fact_death');
            case 'Marriage': return t('fact_marriage');
        }
    }).join(' · ');
}
