/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { PersonResult } from '@/lib/db/schema';

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, values?: Record<string, unknown>) =>
        Object.entries(values ?? {}).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), key),
}));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));

const search = vi.fn();
vi.mock('@/lib/data', () => ({ getDataClient: () => Promise.resolve({ people: { search } }) }));

import WhoIsThisModal from '@/app/components/lightbox/WhoIsThisModal';

const person = (Id: number, FirstName: string, LastName: string, extra: Partial<PersonResult> = {}): PersonResult =>
    ({ Id, FirstName, LastName, Sex: 'M', BirthDate: null, DeathDate: null, ...extra });

/**
 * #793 (task audit MD-1): typing "Порфирий Иванович" and pressing Enter tagged
 * "Никифор Порфирий Иванович Vale", a first match no row showed as chosen.
 */
describe('face-tag picker keyboard (#793)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        search.mockResolvedValue([
            person(1, 'Никифор Порфирий', 'Иванович Vale', { ParentName1: 'Порфирий Vale' }),
            person(2, 'Порфирий', 'Иванович', { PartnerName: 'Анна Иванова' }),
        ]);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    async function openPicker(onPick: (p: PersonResult) => void) {
        render(
            <WhoIsThisModal pickerRef={null} excludeIds={[]} treeId={1} mediaId={1}
                region={{ RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20 }}
                busy={false} onPick={onPick} onCancel={() => {}} />,
        );
        const input = screen.getByRole('combobox');
        input.focus();
        fireEvent.change(input, { target: { value: 'Порфирий Иванович' } });
        await act(async () => { await vi.advanceTimersByTimeAsync(350); });
        return input;
    }

    it('tags the highlighted row on Enter, and nothing before a row is highlighted', async () => {
        const onPick = vi.fn();
        const input = await openPicker(onPick);

        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onPick).not.toHaveBeenCalled();

        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        const active = screen.getAllByRole('option')[1];
        expect(input).toHaveAttribute('aria-activedescendant', active.id);
        expect(active).toHaveTextContent('partner_of');

        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onPick).toHaveBeenCalledOnce();
        expect(onPick.mock.calls[0][0].Id).toBe(2);
    });
});
