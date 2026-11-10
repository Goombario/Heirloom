/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// next-intl returns the key so we can assert on stable identifiers.
vi.mock('next-intl', () => ({
    // `rich` for the full Lifespan: the key plus its date, so years stay assertable.
    useTranslations: () => Object.assign((key: string) => key, {
        rich: (key: string, args?: Record<string, unknown>) => `${key} ${args?.date ?? ''} ${args?.place ?? ''}`,
    }),
}));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/date-input/aliases', () => ({ useDateQualifierWords: () => ({}) }));

import { PersonSummaryView } from '@/app/people/view/PersonSummaryView';
import type { PersonSummary } from '@/app/people/view/personCache';

const summary = {
    Id: 7,
    FirstName: 'Ada',
    LastName: 'Lovelace',
    Sex: 'F',
    IsDeceased: 1,
    BirthDate: '1815',
    DeathDate: '1852',
    BirthPlace: 'London, England',
    DeathPlace: 'Marylebone, London',
} as unknown as PersonSummary;

describe('PersonSummaryView', () => {
    it('paints the known identity (name, dates, place, sex) plus body skeletons', () => {
        const { container, getByText } = render(<PersonSummaryView summary={summary} treeId={1} />);

        // Identity the summary knows, painted immediately.
        expect(getByText('Ada Lovelace')).toBeInTheDocument();
        expect(container.textContent).toContain('1815');
        expect(container.textContent).toContain('London'); // BirthPlace short form
        expect(getByText('sex_female')).toBeInTheDocument(); // sex badge (key via mock)

        // Deceased ⇒ no "living" badge.
        expect(container.textContent).not.toContain('living');

        // Body is still loading ⇒ skeleton placeholders + busy flag.
        expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
        expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    });

    it('falls back to initials avatar when there is no primary photo', () => {
        const { container } = render(<PersonSummaryView summary={summary} treeId={1} />);
        // No PrimaryMediaId ⇒ initials, no <img>.
        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toContain('AL');
    });
});
