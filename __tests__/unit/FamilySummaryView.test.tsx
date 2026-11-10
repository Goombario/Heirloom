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
    it('paints both partner names, the marriage line, plus body skeletons', () => {
        const { container, getByText } = render(<FamilySummaryView summary={summary} treeId={1} />);

        // Both partners the summary knows, painted immediately.
        expect(getByText('John Smith')).toBeInTheDocument();
        expect(getByText('Jane Doe')).toBeInTheDocument();
        // Marriage subtitle: full place + year.
        expect(container.textContent).toContain('Boston, Massachusetts');
        expect(container.textContent).toContain('1860');

        // Body is still loading ⇒ skeleton placeholders + busy flag.
        expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
        expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    });

    // #486: the summary paints before the full record loads, so it has to reach
    // the same conclusion the detail hero does — otherwise a divorced couple
    // flashes the widow's death year for a frame.
    it('shows a divorce as a date range with its reason, not the death year', () => {
        const divorced = { ...summary, EndedDate: '1875', EndedReason: 'Divorce' } as unknown as FamilySummary;
        const { container } = render(<FamilySummaryView summary={divorced} treeId={1} />);
        expect(container.textContent).toContain('1860–1875');
        expect(container.textContent).not.toContain('married_year');
        expect(container.textContent).toContain('hero_ended_divorce');
    });

    it('leaves a death-ended union as a bare range with no reason note', () => {
        const { container } = render(<FamilySummaryView summary={summary} treeId={1} />);
        expect(container.textContent).toContain('1860–1890');
        expect(container.textContent).not.toContain('hero_ended_');
    });

    it('falls back to initials when a partner has no primary photo', () => {
        const { container } = render(<FamilySummaryView summary={summary} treeId={1} />);
        // No media ids ⇒ initials, no <img>.
        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toContain('JS'); // John Smith
        expect(container.textContent).toContain('JD'); // Jane Doe
    });

    it('paints the partner-name title and typed subtitle so the full record does not flip it', () => {
        const typed = { ...summary, Type: 'Marriage' } as unknown as FamilySummary;
        const { container } = render(<FamilySummaryView summary={typed} treeId={1} />);

        // Title = both partners' short names, not the generic "A partnership".
        expect(container.textContent).toContain('hero_title_both(a=John,b=Jane)');
        expect(container.textContent).not.toContain('title_partnership');
        // Subtitle = type phrased naturally + the full place.
        expect(container.textContent).toContain('subtitle_marriage_at(place=Boston, Massachusetts)');
    });

    it('renders the hero_title_one key when only one partner name is known', () => {
        const oneOnly = { ...summary, husbandName: 'John Smith', wifeName: null } as unknown as FamilySummary;
        const { container } = render(<FamilySummaryView summary={oneOnly} treeId={1} />);

        expect(container.textContent).toContain('hero_title_one(a=John)');
        expect(container.textContent).not.toContain('hero_title_both');
        expect(container.textContent).not.toContain('family_fallback');
    });

    it('renders the family_fallback key when neither partner name is known', () => {
        const neither = { ...summary, husbandName: null, wifeName: null } as unknown as FamilySummary;
        const { container } = render(<FamilySummaryView summary={neither} treeId={1} />);

        expect(container.textContent).toContain('family_fallback');
        expect(container.textContent).not.toContain('hero_title_one');
        expect(container.textContent).not.toContain('hero_title_both');
    });
});
