/** @vitest-environment happy-dom */

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { EvidenceView } from '@/app/cases/view/desktop/EvidenceView';
import { findings, lead } from '../setup/case-workspace-ui-fixture';

vi.mock('@/app/components/MediaImg', () => ({ default: () => <img alt="" /> }));

const census = { ...lead, Id: 12, Question: 'Find the census' };

function view() {
    const onOpenRecord = vi.fn();
    render(
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
            <EvidenceView findings={findings} leads={[lead, census]} treeId={1} onOpenRecord={onOpenRecord} onOpenMedia={vi.fn()} />
        </NextIntlClientProvider>,
    );
    return onOpenRecord;
}
const rows = () => within(screen.getByRole('list')).getAllByRole('listitem');

describe('EvidenceView (#58)', () => {
    it('lists each source with how its claims were decided, and nothing-found results', () => {
        view();
        expect(rows()).toHaveLength(3);
        const parish = rows().find((r) => r.textContent?.includes('St Mary parish register'))!;
        expect(parish).toHaveTextContent('1 accepted · 1 undecided · 1 in conflict');
        expect(parish).toHaveTextContent('Kraków diocesan archive — Find her baptism in the parish books');
        expect(screen.getByText('Nothing found in St Florian baptisms 1880–1886')).toBeInTheDocument();
    });

    it('filters by lead and by decision', () => {
        view();
        fireEvent.click(screen.getByRole('button', { name: 'Nothing found' }));
        expect(rows()).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Accepted' }));
        expect(rows()).toHaveLength(1);
        expect(rows()[0]).toHaveTextContent('St Mary parish register');
        fireEvent.click(screen.getByRole('button', { name: 'All' }));
        fireEvent.click(screen.getByRole('combobox', { name: 'Lead' }));
        fireEvent.click(screen.getByRole('option', { name: 'Find the census' }));
        expect(rows()).toHaveLength(1);
        expect(rows()[0]).toHaveTextContent('1900 census');
    });

    it('opens a source in the Record tab', () => {
        const onOpenRecord = view();
        fireEvent.click(screen.getByRole('button', { name: '1900 census, Duluth ward 3' }));
        expect(onOpenRecord).toHaveBeenCalledWith(findings[1]);
    });
});
