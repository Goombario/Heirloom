/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';

const search = vi.fn();
vi.mock('@/lib/data', () => ({ getDataClient: async () => ({ families: { search } }) }));

import { MoveChildPanel } from '@/app/families/view/MoveChildPanel';

describe('MoveChildPanel (#796)', () => {
    it('lists other families with both partners’ years, and picks one', async () => {
        search.mockResolvedValue([
            { Id: 1, husbandName: 'Current Family', wifeName: null, childCount: 2, MarriageDate: null },
            { Id: 2, husbandName: 'Tobias Hallow', wifeName: 'Odette Fennick', childCount: '1', MarriageDate: '1732',
              partner1BirthDate: 'AFT 1703', partner1DeathDate: 'ABT 1735', partner2BirthDate: '1702-11-15', partner2DeathDate: '1740-01' },
        ]);
        const onPick = vi.fn();
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <MoveChildPanel childName="Kid" familyId={1} treeId={1} busy={false} onPick={onPick} onCancel={() => {}} />
            </NextIntlClientProvider>,
        );
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hallow' } });
        const result = await screen.findByRole('button', { name: /Tobias Hallow/ }, { timeout: 2000 });
        expect(result).toHaveTextContent('Tobias Hallow (>1703–~1735) & Odette Fennick (1702–1740)');
        expect(screen.queryByRole('button', { name: /Current Family/ })).toBeNull();
        fireEvent.click(result);
        expect(onPick).toHaveBeenCalledWith({ id: 2, label: 'Tobias Hallow & Odette Fennick' });
    });
});
