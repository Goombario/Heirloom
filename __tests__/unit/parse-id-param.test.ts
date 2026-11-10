import { describe, it, expect } from 'vitest';
import { parseIdParam } from '@/lib/utils/parse-id';

describe('parseIdParam (#867)', () => {
    it('accepts a positive integer within INTEGER range', () => {
        expect(parseIdParam('12')).toBe(12);
        expect(parseIdParam(' 7 ')).toBe(7);
        expect(parseIdParam('2147483647')).toBe(2147483647);
    });

    it('refuses trailing text, fractions, signs, zero and ids past INTEGER range', () => {
        for (const bad of ['12abc', '1.5', '-3', '+3', '0', '1e3', '', '2147483648', '99999999999', 'NaN']) {
            expect(parseIdParam(bad)).toBeNull();
        }
        expect(parseIdParam(null)).toBeNull();
    });

    it('reads a JSON body id sent as a number by the same rules', () => {
        expect(parseIdParam(42)).toBe(42);
        for (const bad of [0, -1, 1.5, 2147483648, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(parseIdParam(bad)).toBeNull();
        }
    });
});
