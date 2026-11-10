/** @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';

function Page({ name }: { name: string | null }) {
    useDocumentTitle(name);
    return null;
}

// Every page's tab title comes from one translated pattern and the page's own
// translated heading, never a hard-coded English string (#729).
describe('useDocumentTitle (#729)', () => {
    it('builds "<page> - Heirloom" and restores the app name on unmount', () => {
        const { unmount } = render(<NextIntlClientProvider locale="en" messages={en}><Page name={en.audit.title} /></NextIntlClientProvider>);
        expect(document.title).toBe(`${en.audit.title} - Heirloom`);
        unmount();
        expect(document.title).toBe('Heirloom');
    });

    it('uses the translated heading it is given', () => {
        render(<NextIntlClientProvider locale="fr" messages={fr}><Page name={fr.options.title} /></NextIntlClientProvider>);
        expect(document.title).toBe(`${fr.options.title} - Heirloom`);
    });

    it('shows the bare app name while there is no page name yet', () => {
        render(<NextIntlClientProvider locale="en" messages={en}><Page name={null} /></NextIntlClientProvider>);
        expect(document.title).toBe('Heirloom');
    });

    it('puts the page title back when the layout rewrites the <title> text', async () => {
        const el = document.head.querySelector('title') ?? document.head.appendChild(document.createElement('title'));
        const { unmount } = render(<NextIntlClientProvider locale="en" messages={en}><Page name="People" /></NextIntlClientProvider>);
        el.textContent = 'Heirloom';
        await waitFor(() => expect(document.title).toBe('People - Heirloom'));
        unmount();
    });

    it('lets the newest page own the title and hands it back on unmount', () => {
        const outer = render(<NextIntlClientProvider locale="en" messages={en}><Page name="People" /></NextIntlClientProvider>);
        const inner = render(<NextIntlClientProvider locale="en" messages={en}><Page name="Ada" /></NextIntlClientProvider>);
        expect(document.title).toBe('Ada - Heirloom');
        inner.unmount();
        expect(document.title).toBe('People - Heirloom');
        outer.unmount();
        expect(document.title).toBe('Heirloom');
    });
});
