/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// next-intl returns "key(arg=value,…)" so we can assert on stable identifiers
// AND on the interpolated partner names the new hero title is built from.
vi.mock('next-intl', () => {
    const t = (key: string, args?: Record<string, unknown>) =>
        args ? `${key}(${Object.entries(args).map(([k, v]) => `${k}=${v}`).join(',')})` : key;
    return { useTranslations: () => Object.assign(t, { rich: (key: string, args?: Record<string, unknown>) => `${key} ${args?.date ?? ''}` }) };
});
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/date-input/aliases', () => ({ useDateQualifierWords: () => ({}) }));

import { FamilySummaryView } from '@/app/families/view/FamilySummaryView';
import type { FamilySummary } from '@/app/families/view/familyCache';

const summary = {
    Id: 12,
    Partner1Id: 1,
    Partner2Id: 2,
    husbandName: 'John Smith',
    wifeName: 'Jane Doe',
    partner1Sex: 'M',
    partner2Sex: 'F',
    husbandMediaId: null,
    wifeMediaId: null,
    husbandFocalX: null,
    husbandFocalY: null,
    husbandFocalRadius: null,
    wifeFocalX: null,
    wifeFocalY: null,
    wifeFocalRadius: null,
    partner1DeathDate: '1890',
    partner2DeathDate: null,
    MarriageDate: '1860',
    MarriagePlace: 'Boston, Massachusetts',
} as unknown as FamilySummary;

describe('FamilySummaryView', () => {
    it('paints the v1.1 cover from the summary, plus body skeletons (#119)', () => {
        const { container } = render(<FamilySummaryView summary={summary} treeId={1} />);
        // Both partners the summary knows, in the title and on the split portrait.
        expect(container.querySelector('h1')).toHaveTextContent('hero_title_both(a=John Smith,b=Jane Doe)');
        expect(container.querySelectorAll('.split-portrait__half')).toHaveLength(2);
        // The years and the short place.
        expect(container.textContent).toContain('1860 – 1890');
        expect(container.textContent).toContain('Boston, Massachusetts');
        // Body is still loading: skeleton placeholders and the busy flag.
        expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
        expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    });

    // #486: the summary paints before the full record loads, so it has to reach
    // the same end year the cover does: a divorce, not the widow's death.
    it('ends a divorced couple at the divorce, not the death year', () => {
        const divorced = { ...summary, EndedDate: '1875', EndedReason: 'Divorce' } as unknown as FamilySummary;
        const { container } = render(<FamilySummaryView summary={divorced} treeId={1} />);
        expect(container.textContent).toContain('1860 – 1875');
    });

    it('falls back to initials when a partner has no primary photo', () => {
        const { container } = render(<FamilySummaryView summary={summary} treeId={1} />);
        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toContain('JS');
        expect(container.textContent).toContain('JD');
    });

    it('names a couple who share a surname once: "Johan & Kristina Lindqvist"', () => {
        const shared = { ...summary, husbandName: 'Johan Lindqvist', wifeName: 'Kristina Lindqvist', partner1LastName: 'Lindqvist', partner2LastName: 'Lindqvist' } as unknown as FamilySummary;
        const { container } = render(<FamilySummaryView summary={shared} treeId={1} />);
        expect(container.querySelector('h1')).toHaveTextContent('cover_title_shared(a=Johan,b=Kristina,last=Lindqvist)');
    });

    it('titles a family with one known partner by that name, and hatches the other half', () => {
        const oneOnly = { ...summary, wifeName: null, Partner2Id: null } as unknown as FamilySummary;
        const { container } = render(<FamilySummaryView summary={oneOnly} treeId={1} />);
        expect(container.querySelector('h1')).toHaveTextContent('John Smith');
        expect(container.querySelectorAll('.split-portrait__half--unknown')).toHaveLength(1);
    });

    it('falls back to "Family" when neither partner name is known', () => {
        const neither = { ...summary, husbandName: null, wifeName: null } as unknown as FamilySummary;
        const { container } = render(<FamilySummaryView summary={neither} treeId={1} />);
        expect(container.querySelector('h1')).toHaveTextContent('family_fallback');
    });
});
