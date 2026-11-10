import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '@/lib/data/errors';

const peopleGet = vi.fn();
vi.mock('@/lib/data', () => ({
    getDataClient: () => Promise.resolve({ people: { get: peopleGet } }),
}));

import { dataCache } from '@/lib/data/cache';
import { loadPartnerFamilies, partnerFamiliesKey } from '@/app/families/view/familyCache';

describe('familyCache partner result', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dataCache.clear();
    });

    it('returns an error-bearing result and does not cache empty partners on failure', async () => {
        const failure = new NotFoundError('server detail must not leak');
        peopleGet.mockRejectedValueOnce(failure);

        const result = await loadPartnerFamilies(901, 77);

        expect(result.person).toBeNull();
        expect(result.spouses).toEqual([]);
        expect(result.error).toBe(failure);
        expect(dataCache.has(partnerFamiliesKey(77, 901))).toBe(false);
    });

    it('caches a successful empty partnership result separately from a failure', async () => {
        peopleGet.mockResolvedValueOnce({ Id: 901, spouses: [] });

        const result = await loadPartnerFamilies(901, 77);

        expect(result.error).toBeUndefined();
        expect(result.spouses).toEqual([]);
        expect(dataCache.get(partnerFamiliesKey(77, 901))).toEqual(result);
    });
});
