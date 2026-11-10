/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const h = vi.hoisted(() => ({ pinChains: vi.fn() }));

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, values?: Record<string, unknown>) =>
        values ? `${key}:${Object.values(values).join(',')}` : key,
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useActiveTreeIdIfAny: () => 7 }));
vi.mock('@/lib/data', () => ({ getDataClient: async () => ({ places: { pinChains: h.pinChains } }) }));

import { SearchRecordsPanel } from '@/app/components/research/SearchRecordsPanel';
import { personResearchSubject } from '@/lib/research/subject';

const subject = personResearchSubject(
    {
        FirstName: 'Edith', LastName: 'Hollis', Sex: 'F', BirthDate: '1868', BirthPlace: 'Maidstone, Kent',
        DeathDate: null, DeathPlace: null, IsDeceased: 1,
    },
    [],
    'PersonBirth',
    1,
    2026,
)!;

/** A place written without its country takes the one the gazetteer files it under (#1030). */
describe('SearchRecordsPanel gazetteer country', () => {
    it('offers the regional sites of the country the place is filed under', async () => {
        h.pinChains.mockResolvedValue({
            'Maidstone, Kent': [
                { name: 'England', latitude: null, longitude: null, pinSuppressed: false, displayName: null },
                { name: 'Kent', latitude: null, longitude: null, pinSuppressed: false, displayName: null },
                { name: 'Maidstone, Kent', latitude: null, longitude: null, pinSuppressed: false, displayName: null },
            ],
        });
        render(<SearchRecordsPanel subject={subject} canCite />);

        expect(screen.queryByRole('link', { name: 'open_site:FreeBMD' })).toBeNull();
        expect(await screen.findByRole('link', { name: 'open_site:FreeBMD' })).toBeInTheDocument();
        expect(h.pinChains).toHaveBeenCalledWith(['Maidstone, Kent'], 7);
    });

    it('keeps the worldwide sites when the lookup fails', async () => {
        h.pinChains.mockRejectedValue(new Error('offline'));
        render(<SearchRecordsPanel subject={subject} canCite />);
        await Promise.resolve();
        expect(screen.queryByRole('link', { name: 'open_site:FreeBMD' })).toBeNull();
        expect(screen.getByRole('link', { name: 'open_site:FamilySearch' })).toBeInTheDocument();
    });
});
