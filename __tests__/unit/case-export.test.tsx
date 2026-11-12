/** @vitest-environment happy-dom */

import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { CaseReport } from '@/app/cases/view/desktop/CaseReport';
import { caseExportJson, caseExportName } from '@/app/cases/view/desktop/case-export';
import type { CaseWithRelations, CaseWorkspace } from '@/lib/db/schema';
import { findings, lead, requests, summary } from '../setup/case-workspace-ui-fixture';

const caseData: CaseWithRelations = {
    Id: 12, UserId: 1, Title: 'Where was Anna Kowalski baptised?', Description: 'She said Kraków.', Status: 'closed', Tags: ['Kowalski'],
    CreatedAt: '2026-11-01T12:00:00Z', UpdatedAt: '2026-11-11T12:00:00Z', FromYear: 1880, ToYear: 1886, Place: 'Kraków',
    Outcome: 'answered', ClosedAt: '2026-11-11T12:00:00Z',
    people: [{ Id: 7, FirstName: 'Anna', LastName: 'Kowalski', Sex: 'F' }],
    media: [], citations: [],
    comments: [
        { Id: 1, CaseId: 12, UserId: 1, Body: 'Try St Mary first.', CreatedAt: '2026-11-02T12:00:00Z', Kind: null, UserName: 'Researcher', UserEmail: 'someone@example.com', leadIds: [11],
            StruckAt: '2026-11-03T12:00:00Z', StruckByName: 'Researcher', StruckReason: 'Wrong parish' },
        { Id: 2, CaseId: 12, UserId: 1, Body: 'St Mary parish register, baptisms 1880–1890', CreatedAt: '2026-11-10T12:00:00Z', Kind: 'finding', FindingId: 21, leadIds: [11] },
        { Id: 3, CaseId: 12, UserId: 1, Body: 'Baptised at St Mary, Kraków.', CreatedAt: '2026-11-11T12:00:00Z', Kind: 'conclusion', leadIds: [] },
    ],
};
const workspace: CaseWorkspace = { leads: [lead], findings, requests };

describe('Export the case (#58)', () => {
    it('JSON holds every record of the case, by id, and no account emails', () => {
        const out = caseExportJson(caseData, workspace, new Date('2026-11-12T00:00:00Z'));
        expect(out).toMatchObject({ format: 'heirloom-case', version: 1, exportedAt: '2026-11-12T00:00:00.000Z' });
        expect(out.case).toMatchObject({ id: 12, question: 'Where was Anna Kowalski baptised?', outcome: 'answered', fromYear: 1880, place: 'Kraków' });
        expect(out.leads).toEqual([expect.objectContaining({ id: 11, status: 'waiting', people: [{ id: 7, name: 'Anna Kowalski' }] })]);
        expect(out.findings).toHaveLength(3);
        expect(out.findings[0]).toMatchObject({ id: 21, leadIds: [11], source: { title: 'St Mary parish register, baptisms 1880–1890', page: 'p. 41, entry 112' } });
        expect(out.findings[0].claims[0]).toMatchObject({ id: 31, what: 'BIRT', person: 'Anna Kowalski', decision: 'accepted' });
        expect(out.findings[2]).toMatchObject({ kind: 'nothing', searched: 'St Florian baptisms 1880–1886', source: null });
        expect(out.requests[0]).toMatchObject({ id: 41, leadId: 11, reference: 'KR-2291', state: 'waiting' });
        expect(out.journal[0]).toMatchObject({ kind: 'note', by: 'Researcher', struckReason: 'Wrong parish', leadIds: [11] });
        expect(JSON.stringify(out)).not.toContain('someone@example.com');
    });

    it('names the file after the case', () => {
        expect(caseExportName(caseData, 'json')).toBe('case-12-where-was-anna-kowalski-baptised.json');
        expect(caseExportName({ Id: 3, Title: '???' }, 'json')).toBe('case-3.json');
    });

    it('the PDF lays out the answer, each lead with its records and decisions, requests and the journal', () => {
        render(
            <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
                <CaseReport caseData={caseData} workspace={workspace} summaries={[summary]} />
            </NextIntlClientProvider>,
        );
        expect(screen.getByRole('heading', { level: 1, name: 'Where was Anna Kowalski baptised?' })).toBeInTheDocument();
        expect(screen.getByText(/Closed · Answered/)).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 2, name: 'The answer' }).closest('section')).toHaveTextContent('Baptised at St Mary, Kraków.');
        const leadSection = screen.getByRole('heading', { level: 2, name: lead.Question }).closest('section')!;
        expect(leadSection).toHaveTextContent('St Mary parish register, baptisms 1880–1890');
        expect(within(leadSection).getAllByText('Accepted').length).toBeGreaterThan(0);
        expect(leadSection).toHaveTextContent('Nothing found in St Florian baptisms 1880–1886');
        expect(leadSection).toHaveTextContent('Baptism certificate · Kraków diocesan archive · Their reference KR-2291 · waiting');
        const journal = screen.getByRole('heading', { level: 2, name: 'Journal' }).closest('section')!;
        expect(journal).toHaveTextContent('Try St Mary first.');
        expect(journal).toHaveTextContent('Wrong parish');
    });
});
