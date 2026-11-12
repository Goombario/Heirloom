/** @vitest-environment happy-dom */

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { LeadView } from '@/app/cases/view/desktop/LeadView';
import { LeadsRail } from '@/app/cases/view/desktop/LeadsRail';
import { loggedEntryText } from '@/app/cases/view/case-detail-helpers';
import type { CaseComment, CaseWithRelations } from '@/lib/db/schema';
import { findings, requests, summary } from '../setup/case-workspace-ui-fixture';

vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <span /> }));
vi.mock('@/app/components/MediaImg', () => ({ default: () => <img alt="" /> }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const wrap = (ui: ReactNode) => render(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC">{ui}</NextIntlClientProvider>);

function view(over: Partial<Parameters<typeof LeadView>[0]> = {}) {
    const handlers = { onEdit: vi.fn(), onSettle: vi.fn(), onReopen: vi.fn(), onDrop: vi.fn(), onDecide: vi.fn(), onReply: vi.fn(), onOpenMedia: vi.fn() };
    wrap(<LeadView summary={summary} findings={findings} requests={requests} comments={[]} settledLeadIds={new Set()} treeId={1} canEdit busy={false} {...handlers} {...over} />);
    return handlers;
}

describe('LeadView (#58)', () => {
    it('draws a timeline of what the tree knows, what was found, and the years with no record', () => {
        view({ facts: [{ PersonId: 7, Type: 'BIRT', Date: '1880' }, { PersonId: 99, Type: 'DEAT', Date: '1881' }] });
        const timeline = screen.getByRole('region', { name: 'Timeline' });
        expect(timeline).toHaveTextContent('1880: Birth · Anna Kowalski, in the tree');
        // Someone not on the lead is left out.
        expect(timeline).not.toHaveTextContent('1881: Death');
        expect(timeline).toHaveTextContent('1882: Birth · St Mary parish register, baptisms 1880–1890, found');
        expect(timeline).toHaveTextContent('1883: Birth · 1900 census, Duluth ward 3, found');
    });

    it('puts two findings that disagree side by side, and Which holds? decides both claims', () => {
        const h = view();
        const panel = screen.getByRole('region', { name: /Two findings disagree/ });
        expect(panel).toHaveTextContent('12 Mar 1882, Kraków');
        expect(panel).toHaveTextContent('Mar 1883, Austria');
        const holds = within(panel).getByRole('radiogroup', { name: 'Which holds: Birth, Anna Kowalski' });
        // Claim 31 is accepted and 33 undecided: not yet a choice.
        expect(within(holds).getByRole('radio', { name: 'Undecided' })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(within(holds).getByRole('radio', { name: '1900 census, Duluth ward 3' }));
        expect(h.onDecide).toHaveBeenCalledWith(expect.objectContaining({ Id: 31 }), 'rejected');
        expect(h.onDecide).toHaveBeenCalledWith(expect.objectContaining({ Id: 33 }), 'accepted');
    });

    it('shows the lead with its status, years, undecided count and people', () => {
        view();
        expect(screen.getByRole('heading', { level: 2, name: 'Find her baptism in the parish books' })).toBeInTheDocument();
        expect(screen.getByText('In progress')).toBeInTheDocument();
        expect(screen.getByText('2 claims undecided')).toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'People in this lead' })).toHaveTextContent('Anna Kowalski');
    });

    it('lists the request it is waiting on, and Log the reply opens it', () => {
        const h = view();
        expect(screen.getByText('Baptism certificate')).toBeInTheDocument();
        expect(screen.getByText(/Their reference KR-2291/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Log the reply' }));
        expect(h.onReply).toHaveBeenCalledWith(requests[0]);
    });

    it('shows each record with its claims and how they stand against the others', () => {
        view();
        const parish = screen.getByRole('article', { name: 'St Mary parish register, baptisms 1880–1890' });
        expect(within(parish).getByText('Conflicts with 1900 census, Duluth ward 3')).toBeInTheDocument();
        expect(screen.getByRole('article', { name: '1900 census, Duluth ward 3' })).toHaveTextContent('Also under 1 other lead');
        expect(screen.getByText('Nothing found in St Florian baptisms 1880–1886')).toBeInTheDocument();
    });

    it('decides a claim in place, and the pressed choice does nothing', () => {
        const h = view();
        const birth = within(screen.getByRole('article', { name: 'St Mary parish register, baptisms 1880–1890' })).getByRole('group', { name: 'Decision on Birth' });
        expect(within(birth).getByRole('button', { name: 'Accept' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(within(birth).getByRole('button', { name: 'Accept' }));
        expect(h.onDecide).not.toHaveBeenCalled();
        fireEvent.click(within(birth).getByRole('button', { name: 'Reject' }));
        expect(h.onDecide).toHaveBeenCalledWith(findings[0].claims[0], 'rejected');
    });

    it('locks the decisions of a finding filed under a settled lead', () => {
        view({ settledLeadIds: new Set([12]) });
        const census = screen.getByRole('article', { name: '1900 census, Duluth ward 3' });
        for (const b of within(census).getAllByRole('button')) expect(b).toBeDisabled();
        const parish = screen.getByRole('article', { name: 'St Mary parish register, baptisms 1880–1890' });
        for (const b of within(parish).getAllByRole('button', { name: 'Reject' })) expect(b).toBeEnabled();
    });

    it('a settled lead says so and offers Reopen', () => {
        const h = view({ summary: { ...summary, status: 'settled', undecided: 0, lead: { ...summary.lead, SettledAt: '2026-11-12T12:00:00Z' } }, settledLeadIds: new Set([11]) });
        expect(screen.getByText(/This lead is settled/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
        expect(h.onReopen).toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Settle' })).not.toBeInTheDocument();
    });

    it('a viewer sees the decisions but cannot change them or log a reply', () => {
        view({ canEdit: false });
        expect(screen.queryByRole('button', { name: 'Log the reply' })).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Reject' }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    });
});

describe('loggedEntryText (#58)', () => {
    const tCases = (key: string, values?: Record<string, string>) => {
        const msg = (en.cases as Record<string, string>)[key];
        return msg.replace(/\{(\w+)\}/g, (_, k: string) => values?.[k] ?? '');
    };
    const c = (Kind: CaseComment['Kind'], Body: string) => ({ Kind, Body }) as CaseComment;

    it('names the workspace steps the app logged, and leaves written notes alone', () => {
        expect(loggedEntryText(c('lead', 'added'), tCases)).toBe('Lead added');
        expect(loggedEntryText(c('finding', 'St Mary register'), tCases)).toBe('Record found: St Mary register');
        expect(loggedEntryText(c('search', 'St Florian'), tCases)).toBe('Searched St Florian, nothing found');
        expect(loggedEntryText(c('status', 'on_hold'), tCases)).toBe('Put on hold');
        expect(loggedEntryText(c(null, 'A note'), tCases)).toBeNull();
        expect(loggedEntryText(c('conclusion', 'Answer'), tCases)).toBeNull();
    });
});

describe('LeadsRail (#58)', () => {
    const caseData = {
        Id: 1, Title: 'Where was Anna Kowalski born?', Description: 'Family says Kraków.', FromYear: 1880, ToYear: 1886, Place: 'Kraków',
        Tags: ['poland'], people: [{ Id: 7, FirstName: 'Anna', LastName: 'Kowalski', Sex: 'F' }], media: [],
        citations: [{ Id: 5, SourceId: 2, sourceTitle: 'Family bible', Page: 'flyleaf' }],
    } as unknown as CaseWithRelations;

    function rail(canEdit = true) {
        const h = { onOpen: vi.fn(), onNewLead: vi.fn(), onEditAbout: vi.fn(), onAddPhotos: vi.fn(), onOpenPhoto: vi.fn(), onCite: vi.fn(), onOpenCitation: vi.fn() };
        wrap(<LeadsRail caseData={caseData} treeId={1} summaries={[summary]} view={{ kind: 'lead', leadId: 11 }} evidenceCount={3} canEdit={canEdit} {...h} />);
        return h;
    }

    it('lists the leads with the open one current, and opens another view', () => {
        const h = rail();
        expect(screen.getByRole('button', { name: /Find her baptism/ })).toHaveAttribute('aria-current', 'page');
        fireEvent.click(screen.getByRole('button', { name: /All evidence/ }));
        expect(h.onOpen).toHaveBeenCalledWith({ kind: 'evidence' });
    });

    it('shows what the case is about, its sources and tags, and cites from there', () => {
        const h = rail();
        const about = screen.getByRole('region', { name: 'About this case' });
        expect(about).toHaveTextContent('Family says Kraków.');
        expect(about).toHaveTextContent('1880 – 1886');
        expect(about).toHaveTextContent('poland');
        fireEvent.click(within(about).getByRole('button', { name: /Family bible/ }));
        expect(h.onOpenCitation).toHaveBeenCalledWith(caseData.citations[0], expect.any(HTMLElement));
        fireEvent.click(within(about).getByRole('button', { name: 'Cite' }));
        expect(h.onCite).toHaveBeenCalled();
    });

    it('offers no editing to a viewer', () => {
        rail(false);
        expect(screen.queryByRole('button', { name: 'New lead' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cite' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit about this case' })).not.toBeInTheDocument();
    });
});
