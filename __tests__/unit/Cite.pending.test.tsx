// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const translations: Record<string, string> = {
    pending_source: 'Source pending save',
    source_label_n: 'Source {n}',
    source_label_with_title: 'Source {n}: {title}',
    view_in_library_with_title: 'View {title} in library',
};

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, values?: Record<string, string | number>) =>
        (translations[key] ?? key).replace(/\{(n|title)\}/g, (_, name: string) => String(values?.[name] ?? '')),
}));

import Cite from '@/app/components/Cite';

describe('Cite', () => {
    it('renders a queued source as a nonnumeric pending marker with an accessible label', () => {
        render(<Cite pending />);

        const pin = screen.getByRole('button', { name: 'Source pending save' });
        expect(pin.textContent).toBe('…');
        expect(pin.textContent).not.toContain('0');
    });

    it('keeps an empty pin that cannot act out of the accessibility tree (#861)', () => {
        render(<Cite empty factLabel="Death" />);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders an empty pin with an action as a named button', () => {
        render(<Cite empty factLabel="Death" onClick={() => {}} />);
        expect(screen.getByRole('button', { name: 'attach_source_for' })).toHaveAttribute('tabindex', '0');
    });

    it('continues to render an attached citation using its SourceId', () => {
        render(<Cite n={42} sourceTitle="Parish register" />);

        expect(screen.getByRole('button', { name: 'Source 42: Parish register' }).textContent).toBe('42');
    });
});
