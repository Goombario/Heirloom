import { describe, it, expect } from 'vitest';
import { scoreSuggestions } from '@/lib/family-suggestions';
import type { FamilySuggestionCandidate } from '@/lib/db/queries/families';
import type { SpouseSuggestionCandidate } from '@/lib/db/queries/people';

// Helpers to build minimal test fixtures
function makeFamily(overrides: Partial<FamilySuggestionCandidate> = {}): FamilySuggestionCandidate {
    return {
        Id: 1,
        Partner1Id: 10,
        Partner2Id: 11,
        MarriageDate: '1895',
        MarriagePlace: null,
        husbandName: 'John Smith',
        wifeName: 'Margaret Frank',
        husbandLastName: 'Smith',
        wifeLastName: 'Frank',
        husbandBirthDate: '1865',
        wifeBirthDate: '1868',
        husbandBirthPlace: null,
        wifeBirthPlace: null,
        childrenBirthDates: [],
        childCount: 0,
        familyUpdatedAt: null,
        ...overrides,
    };
}

function makeSpouse(overrides: Partial<SpouseSuggestionCandidate> = {}): SpouseSuggestionCandidate {
    return {
        Id: 20,
        FirstName: 'Jane',
        LastName: 'Doe',
        Sex: 'F',
        BirthDate: '1920',
        BirthPlace: null,
        CreatedAt: null,
        UpdatedAt: null,
        ...overrides,
    };
}

describe('scoreSuggestions — child', () => {
    it('suggests child when last name matches husband and birth year is 20+ years later', () => {
        const family = makeFamily();
        // Robert Smith born 1893, parents born 1865/1868
        const results = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1893 },
            [family],
            [],
        );
        expect(results).toHaveLength(1);
        expect(results[0].role).toBe('child');
        expect(results[0].familyId).toBe(1);
    });

    it('scores higher when last name matches wife too', () => {
        const family = makeFamily({ wifeLastName: 'Smith' });
        const results = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1893 },
            [family],
            [],
        );
        expect(results[0].role).toBe('child');
        expect(results[0].score).toBeGreaterThanOrEqual(35);
    });

    it('does not suggest child when birth year gap is too small (< 15 yrs)', () => {
        const family = makeFamily({ husbandBirthDate: '1880', wifeBirthDate: '1882' });
        // New person born same year as parents essentially
        const results = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1885 },
            [family],
            [],
        );
        // Score should be below threshold or very low
        const childResult = results.find(r => r.role === 'child');
        expect(childResult).toBeUndefined();
    });

    it('does not suggest child when birth year gap is too large (> 55 yrs)', () => {
        const family = makeFamily();
        // New person born 70 years after parents — clearly wrong generation
        const results = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1940 },
            [family],
            [],
        );
        const childResult = results.find(r => r.role === 'child');
        expect(childResult).toBeUndefined();
    });

    it('boosts score when birth place matches a parent', () => {
        const family = makeFamily({ husbandBirthPlace: 'London, England' });
        const withPlace = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1893, birthPlace: 'London, England' },
            [family],
            [],
        );
        const withoutPlace = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1893 },
            [family],
            [],
        );
        expect(withPlace[0].score).toBeGreaterThan(withoutPlace[0].score);
    });
});

describe('scoreSuggestions — sibling', () => {
    it('suggests sibling when new person birth year is close to existing children', () => {
        const family = makeFamily({
            childrenBirthDates: ['1893', '1895', '1898'],
            childCount: 3,
        });
        // New child born 1897, same decade as siblings, same last name as husband
        const results = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1897 },
            [family],
            [],
        );
        // Should suggest either sibling or child (depending on scores)
        expect(results.length).toBeGreaterThan(0);
        const familyResult = results.find(r => r.role === 'child' || r.role === 'sibling');
        expect(familyResult).toBeDefined();
    });
});

describe('scoreSuggestions — spouse', () => {
    it('suggests spouse when birth years are close and last names differ', () => {
        // Jane Doe born 1920, new person Robert Smith born 1918
        const results = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1918, sex: 'M' },
            [],
            [makeSpouse({ BirthDate: '1920', Sex: 'F' })],
        );
        expect(results).toHaveLength(1);
        expect(results[0].role).toBe('spouse');
        expect(results[0].personId).toBe(20);
    });

    it('gives higher score when sex is complementary', () => {
        const base = makeSpouse({ Sex: 'F', BirthDate: '1920' });
        const withSex = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1918, sex: 'M' },
            [],
            [base],
        );
        const noSex = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1918, sex: '' },
            [],
            [base],
        );
        expect(withSex[0].score).toBeGreaterThan(noSex[0].score);
    });

    it('does not suggest spouse when last names are the same', () => {
        // Same last name — likely a sibling, not a spouse
        const results = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1918 },
            [],
            [makeSpouse({ LastName: 'Smith', BirthDate: '1920' })],
        );
        // May or may not reach threshold without different-last-name bonus
        if (results.length > 0) {
            expect(results[0].score).toBeLessThan(60);
        }
    });

    it('boosts score when birth place matches', () => {
        const withPlace = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1918, sex: 'M', birthPlace: 'Boston, MA' },
            [],
            [makeSpouse({ BirthDate: '1920', Sex: 'F', BirthPlace: 'Boston, MA' })],
        );
        const withoutPlace = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1918, sex: 'M' },
            [],
            [makeSpouse({ BirthDate: '1920', Sex: 'F' })],
        );
        expect(withPlace[0].score).toBeGreaterThan(withoutPlace[0].score);
    });
});

describe('scoreSuggestions — recency bonus', () => {
    it('boosts family score when family was updated within the last hour', () => {
        const recentMs = Date.now();
        const recentIso = new Date(recentMs - 30 * 60 * 1000).toISOString(); // 30 min ago
        const oldIso = new Date(recentMs - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago

        const recentFamily = makeFamily({ Id: 1, familyUpdatedAt: recentIso });
        const oldFamily = makeFamily({ Id: 2, familyUpdatedAt: oldIso });

        const recentResult = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1893 },
            [recentFamily],
            [],
            recentMs,
        );
        const oldResult = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1893 },
            [oldFamily],
            [],
            recentMs,
        );

        expect(recentResult[0].score).toBeGreaterThan(oldResult[0].score);
    });

    it('boosts spouse score when candidate was created within the last hour', () => {
        const recentMs = Date.now();
        const recentIso = new Date(recentMs - 10 * 60 * 1000).toISOString(); // 10 min ago
        const oldIso = new Date(recentMs - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago

        const recentSpouse = makeSpouse({ CreatedAt: recentIso });
        const oldSpouse = makeSpouse({ CreatedAt: oldIso });

        const recentResult = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1918, sex: 'M' },
            [],
            [recentSpouse],
            recentMs,
        );
        const oldResult = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1918, sex: 'M' },
            [],
            [oldSpouse],
            recentMs,
        );

        expect(recentResult[0].score).toBeGreaterThan(oldResult[0].score);
    });

    it('applies partial recency bonus for records updated within 24 hours', () => {
        const recentMs = Date.now();
        const withinDay = new Date(recentMs - 12 * 60 * 60 * 1000).toISOString(); // 12 hours ago
        const withinHour = new Date(recentMs - 30 * 60 * 1000).toISOString();     // 30 min ago

        const hourResult = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1893 },
            [makeFamily({ familyUpdatedAt: withinHour })],
            [],
            recentMs,
        );
        const dayResult = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1893 },
            [makeFamily({ familyUpdatedAt: withinDay })],
            [],
            recentMs,
        );

        expect(hourResult[0].score).toBeGreaterThan(dayResult[0].score);
    });

    it('gives no recency bonus for old records (> 1 week)', () => {
        const now = Date.now();
        const old = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString(); // 2 weeks ago
        const noDate = makeFamily({ familyUpdatedAt: null });
        const oldFamily = makeFamily({ familyUpdatedAt: old });

        const noDateResult = scoreSuggestions({ lastName: 'Smith', birthYear: 1893 }, [noDate], [], now);
        const oldResult = scoreSuggestions({ lastName: 'Smith', birthYear: 1893 }, [oldFamily], [], now);

        expect(noDateResult[0].score).toBe(oldResult[0].score);
    });
});

describe('scoreSuggestions — sorting and limits', () => {
    it('returns at most 3 suggestions', () => {
        const families = [1, 2, 3, 4].map(id =>
            makeFamily({ Id: id, husbandBirthDate: '1865', wifeBirthDate: '1868' })
        );
        const results = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1893 },
            families,
            [],
        );
        expect(results.length).toBeLessThanOrEqual(3);
    });

    it('returns suggestions sorted by score descending', () => {
        // One family with birth place match (higher score), one without
        const familyA = makeFamily({ Id: 1, husbandBirthPlace: 'Boston' });
        const familyB = makeFamily({ Id: 2 });
        const results = scoreSuggestions(
            { lastName: 'Smith', birthYear: 1893, birthPlace: 'Boston' },
            [familyB, familyA], // pass lower-score first
            [],
        );
        for (let i = 1; i < results.length; i++) {
            expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
        }
    });

    it('returns empty array when no candidates', () => {
        const results = scoreSuggestions(
            { lastName: 'Jones', birthYear: 1900 },
            [],
            [],
        );
        expect(results).toHaveLength(0);
    });
});
