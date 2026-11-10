/** @vitest-environment happy-dom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { RecordNotFoundMessage } from '@/app/components/RecordNotFound';

describe('RecordNotFoundMessage (#697)', () => {
    it('on a page: an h1, a link back to the list and one to the audit log', () => {
        render(<RecordNotFoundMessage record="place" />);
        expect(screen.getByRole('heading', { level: 1, name: 'not_found_place' })).toBeTruthy();
        expect(screen.getByRole('link', { name: /back_to_places/ }).getAttribute('href')).toBe('/places');
        expect(screen.getByRole('link', { name: 'open_audit_log' }).getAttribute('href')).toBe('/audit');
    });

    it('in a dialog: an h2 carrying the dialog title id, and back closes instead of navigating', () => {
        const onBack = vi.fn();
        render(<RecordNotFoundMessage record="source" titleId="dlg-title" onBack={onBack} />);
        expect(screen.getByRole('heading', { level: 2, name: 'not_found_source' }).id).toBe('dlg-title');
        fireEvent.click(screen.getByRole('button', { name: /back_to_library/ }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
