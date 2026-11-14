/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import en from '@/messages/en.json';
import { SourceDetailBody } from '@/app/library/source-modal/parts';
import type { CitedByRow } from '@/lib/db/queries/citations';
import type { Source } from '@/lib/data/types';

vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/notes/OwnerNotesCard', () => ({ OwnerNotesCard: () => null, NoteCount: () => null }));
vi.mock('@/app/components/media/OwnerMediaCard', () => ({ OwnerMediaCard: () => null }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));

function row(overrides: Partial<CitedByRow> & Pick<CitedByRow, 'citationId' | 'factTable' | 'factId'>): CitedByRow {
    return {
        personName: null, eventType: null, eventDate: null, variantType: null, variantName: null, caseTitle: null,
        personId: null, caseId: null, personSex: null, personMediaId: null, familyId: null,
        familyPartner1Name: null, familyPartner1Sex: null, familyPartner1MediaId: null,
        familyPartner2Name: null, familyPartner2Sex: null, familyPartner2MediaId: null,
        page: null, quay: null, dataText: null, factDate: null, factPlace: null, sortableYear: null, fileMediaId: null, fileTitle: null, fileContentType: null,
        ...overrides,
    };
}

function Body({ citedBy }: { citedBy: CitedByRow[] }) {
    const t = useTranslations('library');
    return <SourceDetailBody source={{ Id: 1, Title: '1901 Census', Type: 'Census' } as Source} citedBy={citedBy} isMobile={false} t={t} canEdit={false} canDelete={false} treeId={1} />;
}

// #755: readable facts, and cases grouped apart and left out of the count.
describe('What this source proves', () => {
    it('labels events like the timeline, formats dates, and groups cases apart', () => {
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <Body citedBy={[
                    row({ citationId: 1, factTable: 'Cases', factId: 3, caseId: 3, caseTitle: 'Who were her parents?' }),
                    row({ citationId: 2, factTable: 'Events', factId: 9, personId: 4, personName: 'Hazel Bracken', eventType: 'EDUC', eventDate: '1910-05-10' }),
                    row({ citationId: 3, factTable: 'PersonBirth', factId: 4, personId: 4, personName: 'Hazel Bracken' }),
                ]} />
            </NextIntlClientProvider>,
        );

        expect(screen.getByText('2 facts')).toBeTruthy();
        expect(screen.getByText(en.eventTypes.EDUC)).toBeTruthy();
        expect(screen.queryByText('EDUC')).toBeNull();
        expect(screen.queryByText('1910-05-10')).toBeNull();
        expect(screen.getByText('May 10, 1910').classList.contains('date-mono')).toBe(true);

        const research = screen.getByRole('heading', { name: /Used in research/ });
        expect(research.nextElementSibling?.textContent).toContain('Who were her parents?');
        expect(research.previousElementSibling?.textContent).not.toContain('Who were her parents?');
    });
});

// #907: what the source is comes before the facts it proves.
describe('Source detail order', () => {
    it('puts Catalog details above What this source proves', () => {
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <Body citedBy={[]} />
            </NextIntlClientProvider>,
        );
        const catalog = screen.getByText(en.library.catalog_details);
        const proves = screen.getByRole('heading', { name: en.library.proves_title });
        expect(catalog.compareDocumentPosition(proves) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

// #911: a long list groups by fact type, collapsed to counts, with Expand all.
describe('What this source proves, grouped (#911)', () => {
    const births = Array.from({ length: 5 }, (_, i) => row({ citationId: 10 + i, factTable: 'PersonBirth', factId: 20 + i, personId: 20 + i, personName: `Child ${i}`, factDate: `${1900 + i}` }));
    const deaths = Array.from({ length: 2 }, (_, i) => row({ citationId: 30 + i, factTable: 'PersonDeath', factId: 40 + i, personId: 40 + i, personName: `Elder ${i}`, factDate: `${1950 + i}` }));
    const census = row({ citationId: 50, factTable: 'Events', factId: 60, personId: 20, personName: 'Child 0', eventType: 'CENS', eventDate: '1911' });

    const renderBody = (citedBy: CitedByRow[]) => render(
        <NextIntlClientProvider locale="en" messages={en}>
            <Body citedBy={citedBy} />
        </NextIntlClientProvider>,
    );

    it('keeps a short list flat, in the order the query sorted it', () => {
        renderBody([...births.slice(0, 3), census]);
        expect(screen.queryByRole('button', { name: en.library.expand_all })).toBeNull();
        expect(screen.getByText('Child 2')).toBeTruthy();
    });

    it('groups from 8 facts by type, in label order, collapsed to counts', async () => {
        const user = userEvent.setup();
        renderBody([...births, ...deaths, census]);
        const groups = screen.getAllByRole('button', { expanded: false }).filter((b) => b.hasAttribute('aria-controls'));
        expect(groups.map((b) => b.textContent)).toEqual([`${en.library.kind_birth}· 5`, `${en.eventTypes.CENS}· 1`, `${en.library.kind_death}· 2`]);
        expect(screen.queryByText('Child 0')).toBeNull();

        await user.click(groups[0]);
        expect(groups[0]).toHaveAttribute('aria-expanded', 'true');
        expect(document.getElementById(groups[0].getAttribute('aria-controls')!)?.textContent).toContain('Child 4');
        // Each fact shows its own date, birth and death included.
        expect(screen.getByText('1904').classList.contains('date-mono')).toBe(true);
    });

    it('expands and collapses every group at once', async () => {
        const user = userEvent.setup();
        renderBody([...births, ...deaths, census]);
        await user.click(screen.getByRole('button', { name: en.library.expand_all }));
        expect(screen.getByText('Elder 1')).toBeTruthy();
        expect(screen.getByText('Child 3')).toBeTruthy();
        await user.click(screen.getByRole('button', { name: en.library.collapse_all }));
        expect(screen.queryByText('Elder 1')).toBeNull();
    });
});
