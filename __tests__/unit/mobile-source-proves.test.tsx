/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import type { CitedByRow } from '@/lib/db/queries/citations';

const state = vi.hoisted(() => ({ citedBy: [] as unknown[], permission: 'owner' as 'owner' | 'view' }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 1, activePermission: state.permission }) }));
vi.mock('@/lib/data', () => ({ getDataClient: async () => ({ notes: { listForOwner: async () => [] } }) }));
vi.mock('@/app/library/useSourceEditor', () => ({
    useSourceEditor: () => ({ source: { Id: 1, Title: '1911 Census', Type: 'Census' }, citedBy: state.citedBy, loading: false, loadError: null, notFound: false, reload: vi.fn() }),
}));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));
vi.mock('@/app/components/media/MobileOwnerMedia', () => ({ MobileOwnerMedia: () => null }));
vi.mock('@/app/components/notes/MobileNoteSheet', () => ({ MobileNoteSheet: () => null }));
vi.mock('@/app/library/mobile/SourceFormSheet', () => ({ SourceFormSheet: () => null }));
vi.mock('@/app/library/mobile/CiteOnSheets', () => ({ CiteOnSheets: () => null }));
vi.mock('@/app/people/view/mobile/useChange', () => ({ useChange: () => vi.fn() }));

import { MobileSourcePage } from '@/app/library/mobile/MobileSourcePage';

function row(overrides: Partial<CitedByRow> & Pick<CitedByRow, 'citationId' | 'factTable' | 'factId'>): CitedByRow {
    return {
        personName: null, eventType: null, eventDate: null, variantType: null, variantName: null, caseTitle: null,
        personId: null, caseId: null, personSex: null, personMediaId: null, familyId: null,
        familyPartner1Name: null, familyPartner1Sex: null, familyPartner1MediaId: null,
        familyPartner2Name: null, familyPartner2Sex: null, familyPartner2MediaId: null,
        page: null, quay: null, dataText: null, factDate: null, factPlace: null, sortableYear: null,
        ...overrides,
    };
}

const renderPage = (citedBy: CitedByRow[], permission: 'owner' | 'view' = 'owner') => {
    state.citedBy = citedBy;
    state.permission = permission;
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <MobileSourcePage sourceId={1} />
        </NextIntlClientProvider>,
    );
};

const births = Array.from({ length: 5 }, (_, i) => row({ citationId: 10 + i, factTable: 'PersonBirth', factId: 20 + i, personId: 20 + i, personName: `Child ${i}`, factDate: `${1900 + i}`, page: `sch. ${i}` }));
const deaths = Array.from({ length: 2 }, (_, i) => row({ citationId: 30 + i, factTable: 'PersonDeath', factId: 40 + i, personId: 40 + i, personName: `Elder ${i}`, factDate: `${1950 + i}` }));
const marriage = row({ citationId: 50, factTable: 'FamilyMarriage', factId: 7, familyId: 7, familyPartner1Name: 'Tom Bracken', familyPartner2Name: 'Mary Hale', factDate: '1894' });

// #1181: the phone page follows the desktop #911 rule instead of grouping by person.
describe('Phone source page, What it proves', () => {
    it('keeps a short list flat, in query order, as "Fact · Person"', () => {
        renderPage([births[1], marriage, births[0]]);
        expect(screen.queryByRole('button', { name: en.library.expand_all })).toBeNull();
        const rows = screen.getAllByRole('button').filter((b) => b.textContent?.includes(' · '));
        expect(rows.map((b) => b.textContent)).toEqual([
            expect.stringContaining(`${en.library.kind_birth} · Child 1`),
            expect.stringContaining(`${en.library.kind_family} · Tom Bracken & Mary Hale`),
            expect.stringContaining(`${en.library.kind_birth} · Child 0`),
        ]);
        expect(rows[0]).toHaveTextContent('sch. 1');
    });

    it('groups from 8 facts by type, in label order, collapsed to counts', async () => {
        const user = userEvent.setup();
        renderPage([...births, marriage, ...deaths]);
        const groups = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-controls'));
        expect(groups.map((b) => b.textContent)).toEqual([`${en.library.kind_birth}· 5`, `${en.library.kind_death}· 2`, `${en.library.kind_family}· 1`]);
        expect(groups.every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true);
        expect(screen.queryByText('Child 0')).toBeNull();

        await user.click(groups[2]);
        const region = document.getElementById(groups[2].getAttribute('aria-controls')!)!;
        // Inside a group the row names who, not the fact type again.
        expect(within(region).getByText('Tom Bracken & Mary Hale')).toBeTruthy();
        expect(region.textContent).not.toContain(en.library.kind_family);
    });

    it('expands and collapses every group at once', async () => {
        const user = userEvent.setup();
        renderPage([...births, marriage, ...deaths]);
        await user.click(screen.getByRole('button', { name: en.library.expand_all }));
        expect(screen.getByText('Elder 1')).toBeTruthy();
        expect(screen.getByText('Child 3')).toBeTruthy();
        await user.click(screen.getByRole('button', { name: en.library.collapse_all }));
        expect(screen.queryByText('Elder 1')).toBeNull();
    });

    it('links a viewer to the person instead of the citation sheet', () => {
        renderPage([births[0]], 'view');
        expect(screen.getByRole('link', { name: /Child 0/ })).toHaveAttribute('href', '/people/view?id=20');
    });
});
