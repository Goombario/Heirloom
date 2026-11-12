/** @vitest-environment happy-dom */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import type { CaseWithRelations } from '@/lib/db/schema';

const h = vi.hoisted(() => ({
    search: vi.fn(async () => [{ Id: 9, Title: 'St Mary parish register', RepositoryName: 'Kraków archive' }]),
    upload: vi.fn(),
    get: vi.fn(),
}));
vi.mock('@/lib/data', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/data')>()),
    getDataClient: async () => ({ sources: { search: h.search }, media: { upload: h.upload }, people: { get: h.get } }),
}));

import { AddRecordForm } from '@/app/cases/view/desktop/AddRecordForm';
import { RequestForm } from '@/app/cases/view/desktop/RequestForm';
import { FindRecord } from '@/app/cases/view/desktop/FindRecord';
import { lead } from '../setup/case-workspace-ui-fixture';

const wrap = (ui: ReactNode) => render(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC">{ui}</NextIntlClientProvider>);
const other = { ...lead, Id: 12, Question: 'Find the family in the 1900 census', people: [] };

describe('AddRecordForm (#58)', () => {
    it('adds a new source with its claims, filed under the leads it helps', async () => {
        const onSave = vi.fn(async () => true);
        wrap(<AddRecordForm lead={lead} leads={[lead, other]} people={lead.people} treeId={1} onSave={onSave} />);
        fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Family bible' } });
        fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'Aunt Ewa' } });
        fireEvent.change(screen.getByLabelText('Page or entry'), { target: { value: 'flyleaf' } });
        fireEvent.click(screen.getByRole('radio', { name: 'Original' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Find the family in the 1900 census' }));

        fireEvent.click(screen.getByRole('button', { name: 'Add a claim' }));
        fireEvent.change(screen.getByLabelText('It says'), { target: { value: 'Born in Kraków' } });
        fireEvent.change(screen.getByLabelText('Date'), { target: { value: '12 Mar 1882' } });
        fireEvent.click(screen.getByRole('radio', { name: 'Negative' }));
        fireEvent.click(within(screen.getByRole('group', { name: 'Add a claim' })).getByRole('button', { name: 'Add a claim' }));
        expect(screen.getByText(/Born in Kraków, 12 Mar 1882/)).toBeInTheDocument();

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add to the case' })); });
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'record', leadIds: [11, 12], source: { title: 'Family bible', repository: 'Aunt Ewa' }, page: 'flyleaf',
            sourceNature: 'original', information: null, mediaId: null,
            claims: [expect.objectContaining({ what: 'BIRT', personId: 7, says: 'Born in Kraków', date: '12 Mar 1882', evidence: 'negative' })],
        }));
        expect(h.upload).not.toHaveBeenCalled();
    });

    it('files the record under a source already in the library', async () => {
        vi.useFakeTimers();
        const onSave = vi.fn(async () => true);
        wrap(<AddRecordForm lead={lead} leads={[lead]} people={[]} treeId={1} start={{ requestId: 41 }} onSave={onSave} />);
        fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'St Mary' } });
        await act(async () => { await vi.advanceTimersByTimeAsync(250); });
        vi.useRealTimers();
        fireEvent.click(await screen.findByRole('button', { name: /St Mary parish register/ }));
        expect(screen.getByText('Already in your library')).toBeInTheDocument();
        expect(screen.queryByLabelText('Repository')).not.toBeInTheDocument();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add to the case' })); });
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ source: { id: 9 }, requestId: 41, leadIds: [11] }));
    });

    it('needs a source before it can save', () => {
        wrap(<AddRecordForm lead={lead} leads={[lead]} people={[]} treeId={1} onSave={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Add to the case' })).toBeDisabled();
    });
});

describe('RequestForm (#58)', () => {
    it('saves the request with a reminder weeks after it was sent', async () => {
        const onSave = vi.fn(async () => true);
        wrap(<RequestForm details={[{ label: 'Name', value: 'Anna Kowalski' }]} onSave={onSave} />);
        fireEvent.change(screen.getByLabelText('What you asked for'), { target: { value: 'Baptism certificate' } });
        fireEvent.change(screen.getByLabelText('Who holds it'), { target: { value: 'Kraków archive' } });
        fireEvent.click(screen.getByRole('radio', { name: 'Email' }));
        fireEvent.change(screen.getByLabelText('Sent on'), { target: { value: '2026-11-05' } });
        fireEvent.click(screen.getByRole('radio', { name: '4 weeks' }));
        expect(screen.getByRole('button', { name: 'Copy Name' })).toBeInTheDocument();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save the request' })); });
        expect(onSave).toHaveBeenCalledWith({
            askedFor: 'Baptism certificate', holder: 'Kraków archive', sentBy: 'email',
            sentOn: '2026-11-05', reference: null, remindOn: '2026-12-03',
        });
    });

    it('saves no reminder when None is picked', async () => {
        const onSave = vi.fn(async () => true);
        wrap(<RequestForm details={[]} onSave={onSave} />);
        fireEvent.change(screen.getByLabelText('What you asked for'), { target: { value: 'Will' } });
        fireEvent.click(screen.getByRole('radio', { name: 'None' }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save the request' })); });
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ askedFor: 'Will', remindOn: null }));
    });
});

describe('FindRecord (#58)', () => {
    const caseData = { Id: 1, Title: 'Q', people: lead.people, FromYear: null, ToYear: null, Place: 'Kraków' } as unknown as CaseWithRelations;

    it('starts where it was asked to, and switches between the three ways in', () => {
        wrap(<FindRecord lead={{ ...lead, people: [] }} leads={[lead]} caseData={{ ...caseData, people: [] }} treeId={1} start={{ mode: 'request' }} onAddFinding={vi.fn()} onAddRequest={vi.fn()} />);
        expect(screen.getByRole('radio', { name: 'Request it' })).toBeChecked();
        expect(screen.getByLabelText('What you asked for')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('radio', { name: 'Search a site' }));
        expect(screen.getByText(/Add someone to the lead or the case/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('radio', { name: 'Add the record' }));
        expect(screen.getByLabelText('Source')).toBeInTheDocument();
    });

    it('offers the case details to copy with a request', () => {
        wrap(<FindRecord lead={lead} leads={[lead]} caseData={caseData} treeId={1} start={{ mode: 'request' }} onAddFinding={vi.fn()} onAddRequest={vi.fn()} />);
        const details = screen.getByRole('region', { name: 'Case details to copy into their form' });
        expect(details).toHaveTextContent('Anna Kowalski');
        expect(details).toHaveTextContent('1880 – 1886');
        expect(details).toHaveTextContent('Kraków');
    });
});
