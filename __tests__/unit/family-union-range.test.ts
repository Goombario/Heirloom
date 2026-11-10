import { describe, it, expect } from 'vitest';
import { formatUnionRange } from '@/app/families/view/derive';

describe('formatUnionRange', () => {
    it('renders both dates as a range', () => {
        expect(formatUnionRange('1901', '1918')).toBe('1901–1918');
    });

    // A union whose end is known but whose start is not used to render as a bare
    // "1918", which reads as the year it began.
    it('renders an unknown start as a question mark in the normal range position', () => {
        expect(formatUnionRange('', '1918')).toBe('?–1918');
    });

    // A start with no end is not a range — the caller renders it as "m. 1901",
    // so the formatter reports that it has nothing to show.
    it('returns nothing for a start with no end', () => {
        expect(formatUnionRange('1901', '')).toBe('');
    });

    it('returns nothing when neither date is known', () => {
        expect(formatUnionRange('', '')).toBe('');
    });
});
