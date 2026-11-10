/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { CitationLink } from '@/app/components/citations/CitationLink';

describe('CitationLink (#1023)', () => {
    it('opens an http(s) record link in a new tab', () => {
        render(<CitationLink url="https://records.example.org/entry/42" />);
        const link = screen.getByRole('link', { name: 'https://records.example.org/entry/42' });
        expect(link).toHaveAttribute('href', 'https://records.example.org/entry/42');
        expect(link).toHaveAttribute('target', '_blank');
    });

    it('shows any other value as text, not a link', () => {
        render(<CitationLink url="javascript:alert(1)" />);
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
    });
});
