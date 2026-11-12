/** @vitest-environment happy-dom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { AnswerClose } from '@/app/cases/view/desktop/AnswerClose';
import { ClosedAnswer } from '@/app/cases/view/desktop/ClosedAnswer';
import type { CaseChange, CaseWithRelations } from '@/lib/db/schema';
import { findings, lead, summary } from '../setup/case-workspace-ui-fixture';

const change = (claimId: number, over: Partial<CaseChange>): CaseChange => ({
    claimId, findingId: 21, leadIds: [11], kind: 'fill', what: 'BIRT', personId: 7, personLabel: 'Anna Kowalski',
    says: null, date: '1882', place: 'Kraków', fills: { date: false, place: true }, differs: { date: null, place: null },
    sourceTitle: 'St Mary parish register', ...over,
});
const changes: CaseChange[] = [
    change(31, { differs: { date: '1881', place: null } }),
    change(33, { kind: 'event', what: 'RESI', date: '1900', place: 'Duluth', fills: { date: false, place: false } }),
    change(34, { kind: 'fill', what: 'DEAT', date: '1950', place: null, fills: { date: false, place: false }, differs: { date: '1949', place: null } }),
    change(32, { kind: 'by_hand', what: 'PARENTS', says: 'Jan Kowalski and Maria Nowak', date: null, place: null }),
];
vi.mock('@/lib/data', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/data')>()),
    getDataClient: async () => ({ cases: { getChanges: async () => changes } }),
}));

const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC">{ui}</NextIntlClientProvider>);

describe('Answer and close (#58)', () => {
    it('ticks fills and new events, leaves Replace unticked, and lists what is entered by hand', async () => {
        const onClose = vi.fn();
        wrap(<AnswerClose caseId={1} treeId={1} leads={[lead]} summaries={[summary]} busy={false} onGoToLead={vi.fn()} onCancel={vi.fn()} onClose={onClose} />);
        await screen.findByText('Fill in Kraków');
        expect(screen.getByText('1 lead is not settled yet')).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: /Birth · Anna Kowalski/ })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Replace 1881 with 1882' })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: /Residence/ })).toBeChecked();
        // A death the tree already dates otherwise is only a replacement: off until ticked.
        expect(screen.getByRole('checkbox', { name: /Death/ })).not.toBeChecked();
        expect(screen.getByText('Jan Kowalski and Maria Nowak')).toBeInTheDocument();

        const close = screen.getByRole('button', { name: 'Apply 2 changes and close' });
        expect(close).toBeDisabled();
        fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Born in Kraków.' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Replace 1881 with 1882' }));
        fireEvent.click(screen.getByRole('checkbox', { name: /Death/ }));
        fireEvent.click(screen.getByRole('radio', { name: 'Ruled out' }));
        fireEvent.click(screen.getByRole('button', { name: 'Apply 3 changes and close' }));
        expect(onClose).toHaveBeenCalledWith({
            conclusion: 'Born in Kraków.', outcome: 'ruled_out',
            apply: [{ claimId: 31, replace: true }, { claimId: 33, replace: false }, { claimId: 34, replace: true }],
        });
    });

    it('closes without changes', async () => {
        const onClose = vi.fn();
        wrap(<AnswerClose caseId={1} treeId={1} leads={[lead]} summaries={[summary]} busy={false} onGoToLead={vi.fn()} onCancel={vi.fn()} onClose={onClose} />);
        await screen.findByText('Fill in Kraków');
        fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Not found.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Close without changes' }));
        await waitFor(() => expect(onClose).toHaveBeenCalledWith({ conclusion: 'Not found.', outcome: 'answered', apply: [] }));
    });
});

describe('the closed case (#58)', () => {
    it('shows the answer, what it added with Undo, and the leads left open', () => {
        const onUndo = vi.fn();
        const applied = findings.map((f) => ({ ...f, claims: f.claims.map((c) => (c.Id === 31 ? { ...c, AppliedAt: '2026-11-12T12:00:00Z', undoable: true } : c)) }));
        const caseData = { Outcome: 'answered', comments: [{ Id: 1, Kind: 'conclusion', Body: 'She was born in Kraków.' }] } as unknown as CaseWithRelations;
        wrap(<ClosedAnswer caseData={caseData} findings={applied} summaries={[summary]} canUndo canReopen busy={false} onUndo={onUndo} onReopen={vi.fn()} />);
        expect(screen.getByText('She was born in Kraków.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'On the page of Anna Kowalski' })).toHaveAttribute('href', '/people/view?id=7');
        fireEvent.click(screen.getByRole('button', { name: 'Undo Birth for Anna Kowalski' }));
        expect(onUndo).toHaveBeenCalledWith(expect.objectContaining({ Id: 31 }));
        expect(screen.getByRole('link', { name: 'Start a case from it' })).toHaveAttribute('href', `/cases/new?q=${encodeURIComponent(lead.Question)}`);
    });
});
