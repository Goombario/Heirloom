/** @vitest-environment happy-dom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { StartCase } from '@/app/cases/view/desktop/StartCase';

const replace = vi.fn();
const create = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock('@/lib/data', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/data')>()),
    getDataClient: async () => ({ cases: { create } }),
}));
vi.mock('@/app/components/ui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/app/components/ui')>()),
    PersonFinder: ({ onPick }: { onPick: (p: { Id: number; FirstName: string; LastName: string }) => void }) => (
        <button type="button" onClick={() => onPick({ Id: 7, FirstName: 'Anna', LastName: 'Kowalski' })}>Pick Anna</button>
    ),
}));

function view() {
    render(
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
            <StartCase treeId={1} />
        </NextIntlClientProvider>,
    );
}
const question = () => screen.getByRole('textbox', { name: /^Question/ }) as HTMLInputElement;
const startButton = () => screen.getByRole('button', { name: 'Start the case' });

describe('StartCase (#58)', () => {
    beforeEach(() => { replace.mockReset(); create.mockReset(); });

    it('fills the question in from the details until it is edited, and waits for its gaps', () => {
        view();
        expect(startButton()).toBeDisabled();
        fireEvent.click(screen.getByRole('radio', { name: /What were they doing/ }));
        fireEvent.change(screen.getByRole('textbox', { name: 'From year' }), { target: { value: '1880' } });
        expect(question().value).toBe('What was … doing between 1880 and …?');
        expect(startButton()).toBeDisabled();
        fireEvent.change(screen.getByRole('textbox', { name: 'To year' }), { target: { value: '1895' } });
        fireEvent.click(screen.getByRole('button', { name: 'Pick Anna' }));
        expect(question().value).toBe('What was Anna Kowalski doing between 1880 and 1895?');
        expect(startButton()).toBeEnabled();
        fireEvent.change(question(), { target: { value: 'What was Anna doing in Kraków?' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'From year' }), { target: { value: '1881' } });
        expect(question().value).toBe('What was Anna doing in Kraków?');
    });

    it('creates the case with its kind and details, then opens it', async () => {
        create.mockResolvedValue({ Id: 42 });
        view();
        fireEvent.click(screen.getByRole('radio', { name: /Who were their parents/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick Anna' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Focus place' }), { target: { value: 'Kraków' } });
        fireEvent.click(startButton());
        await waitFor(() => expect(replace).toHaveBeenCalledWith('/cases/view?id=42'));
        expect(create).toHaveBeenCalledWith({
            Title: 'Who were the parents of Anna Kowalski?', QuestionKind: 'parents',
            FromYear: null, ToYear: null, Place: 'Kraków', personIds: [7],
        }, 1);
    });

    it('rejects years that run backwards', () => {
        view();
        fireEvent.click(screen.getByRole('radio', { name: /My own question/ }));
        fireEvent.change(question(), { target: { value: 'Who was Jan?' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'From year' }), { target: { value: '1900' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'To year' }), { target: { value: '1890' } });
        expect(screen.getByRole('alert')).toHaveTextContent(en.caseResearch.years_invalid);
        expect(startButton()).toBeDisabled();
    });
});
