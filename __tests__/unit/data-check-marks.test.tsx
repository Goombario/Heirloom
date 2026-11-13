/**
 * @vitest-environment happy-dom
 *
 * Data checks marks on the person and family pages (#833): only the row of a
 * date to fix gets the mark, never the other involved rows or a derived one,
 * and the family hero gets the shared "dates to check" flag.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { runDataChecks } from '@/lib/data-checks/engine';
import type { DataCheckInput } from '@/lib/data-checks/rules';
import type { DataChecksFilter, DataChecksResult } from '@/lib/data/types';
import type { EventWithMedia, PersonWithRelations } from '@/lib/db/schema';

const list = vi.fn();

vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({
        dataChecks: { list },
        notes: { listForOwner: vi.fn(), create: vi.fn(), update: vi.fn(), setPrimary: vi.fn(), remove: vi.fn() },
        places: { pinChains: vi.fn() },
    }),
}));
vi.mock('next/link', () => ({
    default: ({ href, children, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 99 }) }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/InlineEventEditor', () => ({
    default: ({ onCancel }: { onCancel: () => void }) => <div data-testid="event-editor"><button type="button" onClick={onCancel}>Cancel editor</button></div>,
}));
vi.mock('@/app/families/view/InlineMarriageEditor', () => ({ default: () => <div data-testid="marriage-editor" /> }));
vi.mock('@/app/components/media/EventMediaStrip', () => ({ default: () => null }));
vi.mock('@/app/components/media/OwnerMediaCard', () => ({ OwnerMediaCard: () => null }));
vi.mock('@/app/components/LocationMap', () => ({ default: () => null }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));
vi.mock('@/app/components/PersonPicker', () => ({ default: () => null }));
vi.mock('@/app/components/familyEventTypes', async (orig) => ({
    ...(await orig<typeof import('@/app/components/familyEventTypes')>()),
    familyEventLabel: (type: string) => type,
}));

import { LifeEventsPanel } from '@/app/people/view/LifeEventsPanel';
import { FamilyTimeline } from '@/app/families/view/sections';
import { useDataCheckMarks } from '@/app/components/data-checks/marks';
import { DatesToCheckFlag } from '@/app/components/ui';

// Mary Ellen Byrne (1), died aged seven months, and Patrick Doyle (2), died
// 1871. Their divorce (60) is dated before the partnership started. Michael (4),
// Patrick's son in a later family (11), was born 1880, after his father's death.
const input: DataCheckInput = {
    people: [
        { Id: 1, Sex: 'F', BirthDate: '1813', DeathDate: '1814-01-27', IsDeceased: 1 },
        { Id: 2, Sex: 'M', BirthDate: '1810', DeathDate: '1871', IsDeceased: 1 },
        { Id: 3, Sex: 'F', BirthDate: '1843-03-03', DeathDate: null, IsDeceased: 1 },
        { Id: 4, Sex: 'M', BirthDate: '1880', DeathDate: null, IsDeceased: 1 },
    ],
    events: [{ Id: 60, Type: 'DIV', Date: '1830', PersonId: null, FamilyId: 10 }],
    families: [
        { Id: 10, Partner1Id: 2, Partner2Id: 1, MarriageDate: '1842', childIds: [3] },
        { Id: 11, Partner1Id: 2, Partner2Id: null, MarriageDate: '1850', childIds: [4] },
    ],
};
const names = [
    { Id: 1, FirstName: 'Mary Ellen', LastName: 'Byrne', Sex: 'F', BirthDate: '1813', DeathDate: '1814-01-27' },
    { Id: 2, FirstName: 'Patrick', LastName: 'Doyle', Sex: 'M', BirthDate: '1810', DeathDate: '1871' },
    { Id: 3, FirstName: 'Bridget', LastName: 'Doyle', Sex: 'F', BirthDate: '1843-03-03', DeathDate: null },
    { Id: 4, FirstName: 'Michael', LastName: 'Doyle', Sex: 'M', BirthDate: '1880', DeathDate: null },
];

/** The server's filter, over the fixture (`matchesFilter` in the service). */
function listFor(filter: DataChecksFilter): DataChecksResult {
    const problems = runDataChecks(input)
        .filter((p) => filter.personId == null || p.facts.some((f) => f.personId === filter.personId && p.editable.includes(f.key)))
        .filter((p) => filter.familyId == null || p.familyIds.includes(filter.familyId))
        .map((p) => ({ ...p, confirmation: null }));
    return { problems, people: names, families: [{ Id: 10, Partner1Id: 2, Partner2Id: 1 }, { Id: 11, Partner1Id: 2, Partner2Id: null }] };
}

const wrap = (node: React.ReactNode) => <NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>;
const rowOf = (el: HTMLElement) => el.closest('.tl-med-ev, .ledger__ev') as HTMLElement;
const flaggedRows = (container: HTMLElement) => Array.from(container.querySelectorAll('.tl-med-ev.is-flagged, .ledger__ev.is-flagged'));

const maryEllen = {
    Id: 1, UserId: 1, TreeId: 99, FirstName: 'Mary Ellen', LastName: 'Byrne',
    BirthDate: '1813', BirthPlace: null, DeathDate: '1814-01-27', DeathPlace: null, DeathCause: null,
    events: [{ Id: 50, UserId: 1, TreeId: 99, Type: 'BAPM', Date: '1813-03-02', Place: null, Description: null, PersonId: 1, FamilyId: null, media: [], noteCount: 0 }],
} as unknown as PersonWithRelations;

function PersonPage({ canEdit = true }: { canEdit?: boolean }) {
    const marks = useDataCheckMarks({ personId: 1 }, maryEllen);
    return (
        <LifeEventsPanel person={maryEllen} marks={marks} language="en" renderCitePin={() => null}
            tTypes={((k: string) => ({ BIRT: 'Birth', DEAT: 'Death', BAPM: 'Baptism' }[k] ?? k)) as never}
            canEdit={canEdit} canDelete={canEdit} onChanged={() => {}} personNotes={[]} />
    );
}

function FamilyPage({ familyId = 10, events, earlierPartnerId }: { familyId?: number; events: EventWithMedia[]; earlierPartnerId?: number }) {
    const family = input.families.find((f) => f.Id === familyId)!;
    const marks = useDataCheckMarks({ familyId }, family);
    const person = (id: number) => {
        const n = names.find((p) => p.Id === id)!;
        return { ...n, BirthPlace: null, DeathPlace: null } as unknown as React.ComponentProps<typeof FamilyTimeline>['childList'][number];
    };
    return (
        <>
            <DatesToCheckFlag count={marks.open.length} href={`/data-checks?family=${familyId}`} />
            <FamilyTimeline
                family={{ Id: familyId, MarriageDate: family.MarriageDate, MarriagePlace: null, Type: 'Marriage', events }}
                childList={family.childIds.map(person)} citationMap={{}} sourceNumbers={new Map()}
                canEdit canDelete  isOpen={() => false} toggle={() => {}}
                earlierPartner={earlierPartnerId ? person(earlierPartnerId) : null}
                onCitationClick={() => {}} onChanged={() => {}} marks={marks} />
        </>
    );
}

const divorce = { Id: 60, UserId: 1, TreeId: 99, Type: 'DIV', Date: '1830', Place: null, Description: null, PersonId: null, FamilyId: 10, media: [], noteCount: 0 } as unknown as EventWithMedia;

describe('Data checks marks (#833)', () => {
    beforeEach(() => {
        list.mockReset();
        list.mockImplementation(async (_treeId: number, filter: DataChecksFilter) => listFor(filter));
    });

    it("asks only for the page's own person or family", async () => {
        render(wrap(<PersonPage />));
        await waitFor(() => expect(list).toHaveBeenCalledWith(99, { personId: 1, familyId: undefined }));
    });

    it('waits for the record to load, then asks once (#1270)', async () => {
        function Loading({ person }: { person: PersonWithRelations | null }) {
            useDataCheckMarks({ personId: 1 }, person);
            return null;
        }
        const { rerender } = render(wrap(<Loading person={null} />));
        await Promise.resolve();
        expect(list).not.toHaveBeenCalled();
        rerender(wrap(<Loading person={maryEllen} />));
        await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    });

    it("marks Mary Ellen's death row, and not her birth or baptism", async () => {
        const { container } = render(wrap(<PersonPage />));
        const mark = await screen.findByRole('button', { name: /^Check this date: Mary Ellen Byrne died before her/ });
        expect(within(rowOf(mark)).getByText('Death')).toBeInTheDocument();
        expect(flaggedRows(container)).toEqual([rowOf(mark)]);
        expect(rowOf(screen.getByText('Birth'))).not.toHaveClass('is-flagged');
        expect(rowOf(screen.getByText('Baptism'))).not.toHaveClass('is-flagged');
    });

    it('opens a panel with the problem, Edit date and the Data checks link; Escape returns to the mark', async () => {
        const user = userEvent.setup();
        render(wrap(<PersonPage />));
        const mark = await screen.findByRole('button', { name: /^Check this date:/ });
        expect(mark).toHaveAttribute('aria-expanded', 'false');
        await user.click(mark);
        expect(mark).toHaveAttribute('aria-expanded', 'true');
        const panel = screen.getByRole('group', { name: 'Check this date' });
        expect(within(panel).getByText('Mary Ellen Byrne died before her child was born')).toBeInTheDocument();
        expect(within(panel).getByRole('link', { name: 'Open in Data checks' }))
            .toHaveAttribute('href', '/data-checks?entry=child_born_after_mother_death%3A1');

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('group', { name: 'Check this date' })).toBeNull();
        expect(mark).toHaveFocus();

        await user.click(mark);
        await user.click(within(screen.getByRole('group', { name: 'Check this date' })).getByRole('button', { name: 'Edit date' }));
        expect(await screen.findByTestId('event-editor')).toBeInTheDocument();

        // Closing the row's editor returns focus to the mark, not the panel it was opened from.
        await user.click(screen.getByRole('button', { name: 'Cancel editor' }));
        await waitFor(() => expect(screen.queryByTestId('event-editor')).toBeNull());
        expect(screen.getByRole('button', { name: /^Check this date:/ })).toHaveFocus();
    });

    it("puts the panel straight after its mark in Tab order (#843)", async () => {
        const user = userEvent.setup();
        render(wrap(<PersonPage />));
        const mark = await screen.findByRole('button', { name: /^Check this date:/ });
        mark.focus();
        await user.keyboard('{Enter}');
        expect(mark).toHaveAttribute('aria-expanded', 'true');
        // A disclosure keeps focus on its button when it opens.
        expect(mark).toHaveFocus();

        const panel = screen.getByRole('group', { name: 'Check this date' });
        await user.tab();
        expect(within(panel).getByRole('button', { name: 'Edit date' })).toHaveFocus();
        await user.tab();
        expect(within(panel).getByRole('link', { name: 'Open in Data checks' })).toHaveFocus();
        // The row has no hover actions now (it opens its editor from its title),
        // so Tab leaves the panel for whatever follows it.
        await user.tab();
        expect(panel.contains(document.activeElement)).toBe(false);
    });

    it("shows the mark, without Edit date, to a reader who can't edit", async () => {
        const user = userEvent.setup();
        render(wrap(<PersonPage canEdit={false} />));
        await user.click(await screen.findByRole('button', { name: /^Check this date:/ }));
        expect(within(screen.getByRole('group', { name: 'Check this date' })).queryByRole('button', { name: 'Edit date' })).toBeNull();
    });

    it("puts no mark for a confirmed problem", async () => {
        list.mockImplementation(async (_t: number, filter: DataChecksFilter) => {
            const r = listFor(filter);
            return { ...r, problems: r.problems.map((p) => ({ ...p, confirmation: { reason: 'r', confirmedBy: 1, confirmedByName: null, confirmedAt: '' } })) };
        });
        render(wrap(<PersonPage />));
        await waitFor(() => expect(list).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: /^Check this date/ })).toBeNull();
    });

    it("marks the family's divorce, and not the start or the children's births; the hero flag counts the family's checks", async () => {
        const { container } = render(wrap(<FamilyPage events={[divorce]} />));
        const mark = await screen.findByRole('button', { name: /^Check this date:/ });
        expect(within(rowOf(mark)).getByText('DIV')).toBeInTheDocument();
        expect(flaggedRows(container)).toHaveLength(1);
        expect(rowOf(screen.getByText(/Bridget/))).not.toHaveClass('is-flagged');
        expect(rowOf(screen.getByText('Marriage'))).not.toHaveClass('is-flagged');

        const count = listFor({ familyId: 10 }).problems.length;
        expect(count).toBeGreaterThan(1);
        expect(screen.getByText(`${count} dates to check`)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: `Review ${count} dates to check` })).toHaveAttribute('href', '/data-checks?family=10');
    });

    it("puts no mark on a derived row: the partnership end taken from Patrick's death", async () => {
        const { container } = render(wrap(<FamilyPage familyId={11} events={[]} earlierPartnerId={2} />));
        await waitFor(() => expect(screen.getByText('1 date to check')).toBeInTheDocument());
        // Patrick's death is a date to fix (Michael was born after it), but here it's derived.
        expect(listFor({ familyId: 11 }).problems.map((p) => p.editable)).toEqual([['PersonDeath:2']]);
        expect(rowOf(screen.getByText(/Michael/))).not.toHaveClass('is-flagged');
        expect(screen.getByText(en.families.partnership_ended, { exact: false })).toBeInTheDocument();
        expect(flaggedRows(container)).toHaveLength(0);
    });
});

describe('DatesToCheckFlag (#833)', () => {
    it('is a static count and an ink Review link, and nothing when there is nothing to check', () => {
        const { container, rerender } = render(wrap(<DatesToCheckFlag count={1} href="/data-checks?family=3" />));
        expect(screen.getByText('1 date to check').closest('a')).toBeNull();
        expect(screen.getByRole('link', { name: 'Review 1 date to check' })).toHaveAttribute('href', '/data-checks?family=3');
        rerender(wrap(<DatesToCheckFlag count={0} href="/data-checks?family=3" />));
        expect(container).toBeEmptyDOMElement();
    });
});
