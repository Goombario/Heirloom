import { describe, expect, it } from 'vitest';
import { livingStatus, mayBeLiving } from '@/lib/living';

describe('livingStatus (#1021)', () => {
    it('is deceased with the deceased flag or a death date', () => {
        expect(livingStatus({ IsDeceased: 1 })).toBe('deceased');
        expect(livingStatus({ IsDeceased: 0, DeathDate: '1931' })).toBe('deceased');
        expect(livingStatus({ IsDeceased: null, DeathDate: 'ABT 1931' })).toBe('deceased');
    });

    it('is living only with the explicit living flag', () => {
        expect(livingStatus({ IsDeceased: 0 })).toBe('living');
        expect(livingStatus({ IsDeceased: 0, DeathDate: '' })).toBe('living');
    });

    it('is unknown with no death data and no flag', () => {
        expect(livingStatus({ IsDeceased: null })).toBe('unknown');
        expect(livingStatus({})).toBe('unknown');
    });
});

describe('mayBeLiving (#1021)', () => {
    const NOW = 2026;

    it('is false for anyone deceased, whatever the birth', () => {
        expect(mayBeLiving({ IsDeceased: 1, BirthDate: '1990' }, NOW)).toBe(false);
        expect(mayBeLiving({ IsDeceased: null, DeathDate: '2020', BirthDate: '1990' }, NOW)).toBe(false);
    });

    it('is true for someone marked living, whatever the birth', () => {
        expect(mayBeLiving({ IsDeceased: 0, BirthDate: '1850' }, NOW)).toBe(true);
    });

    it('counts a missing or unreadable birth date as may be living', () => {
        expect(mayBeLiving({ IsDeceased: null }, NOW)).toBe(true);
        expect(mayBeLiving({ IsDeceased: null, BirthDate: '' }, NOW)).toBe(true);
        expect(mayBeLiving({ IsDeceased: null, BirthDate: '(about the time of the flood)' }, NOW)).toBe(true);
    });

    it('takes an exact birth within the last 100 years as may be living', () => {
        expect(mayBeLiving({ BirthDate: '14 FEB 1950' }, NOW)).toBe(true);
        expect(mayBeLiving({ BirthDate: '1926' }, NOW)).toBe(true);
        expect(mayBeLiving({ BirthDate: '31 DEC 1925' }, NOW)).toBe(false);
        expect(mayBeLiving({ BirthDate: '1868' }, NOW)).toBe(false);
    });

    it('reads ABT by its latest year', () => {
        // ABT 1922 could be as late as 1927.
        expect(mayBeLiving({ BirthDate: 'ABT 1922' }, NOW)).toBe(true);
        expect(mayBeLiving({ BirthDate: 'ABT 1920' }, NOW)).toBe(false);
    });

    it('reads BEF as at most that date, and AFT as open-ended', () => {
        expect(mayBeLiving({ BirthDate: 'BEF 1900' }, NOW)).toBe(false);
        expect(mayBeLiving({ BirthDate: 'BEF 1960' }, NOW)).toBe(true);
        expect(mayBeLiving({ BirthDate: 'AFT 1900' }, NOW)).toBe(true);
    });

    it('reads BET by its later bound', () => {
        expect(mayBeLiving({ BirthDate: 'BET 1900 AND 1930' }, NOW)).toBe(true);
        expect(mayBeLiving({ BirthDate: 'BET 1880 AND 1910' }, NOW)).toBe(false);
    });
});
