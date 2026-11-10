/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';

vi.mock('next/link', () => ({
    default: ({ href, children, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>,
}));

import { ImportReport } from '@/app/import-export/ImportReport';

const renderReport = (datesToCheck: number | null, duplicates: number | null) => render(
    <NextIntlClientProvider locale="en" messages={en}><ImportReport datesToCheck={datesToCheck} duplicates={duplicates} /></NextIntlClientProvider>,
);

describe('Import result: dates to check (#835, FR-3)', () => {
    it('shows the shared flag with the count, linking to Data checks', () => {
        renderReport(37, 0);
        expect(screen.getByText('37 dates to check').closest('a')).toBeNull();
        expect(screen.getByRole('link', { name: 'Review 37 dates to check' })).toHaveAttribute('href', '/data-checks');
    });

    it('hides the line at zero, or when the checks failed to run, and keeps the duplicates', () => {
        renderReport(0, 2);
        expect(screen.queryByText(/dates? to check/)).toBeNull();
        expect(screen.getByRole('link', { name: 'Review 2 pairs' })).toHaveAttribute('href', '/people?filter=duplicates');
    });

    it('uses one Review link style for both lines: the ink "Review ›" (#843)', () => {
        renderReport(3, 2);
        const links = screen.getAllByRole('link');
        expect(links).toHaveLength(2);
        for (const link of links) {
            expect(link).toHaveTextContent(/^Review$/);
            expect(link.className).toBe(links[0].className);
            expect(link.querySelector('svg')).not.toBeNull();
        }
    });

    it('renders nothing when there is nothing to report', () => {
        for (const [checks, dupes] of [[0, 0], [null, null], [null, 0]] as const) {
            const { container, unmount } = renderReport(checks, dupes);
            expect(container).toBeEmptyDOMElement();
            unmount();
        }
    });
});
