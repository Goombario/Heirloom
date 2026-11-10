import { describe, it, expect } from 'vitest';
import { cycleTri, matchesSexBucket, matchesTri, sexBucketOf, sexBucketsPresent } from '@/app/people/peopleFilters';

describe('cycleTri', () => {
    it('cycles off → yes → no → off', () => {
        expect(cycleTri('off')).toBe('yes');
        expect(cycleTri('yes')).toBe('no');
        expect(cycleTri('no')).toBe('off');
    });
});

describe('matchesTri', () => {
    it('matches everything when off', () => {
        expect(matchesTri('off', true)).toBe(true);
        expect(matchesTri('off', false)).toBe(true);
    });

    it('matches the predicate when yes and its negation when no', () => {
        expect(matchesTri('yes', true)).toBe(true);
        expect(matchesTri('yes', false)).toBe(false);
        expect(matchesTri('no', true)).toBe(false);
        expect(matchesTri('no', false)).toBe(true);
    });
});

describe('sexBucketOf', () => {
    it('maps the recorded codes to their own buckets', () => {
        expect(sexBucketOf('M')).toBe('M');
        expect(sexBucketOf('F')).toBe('F');
        expect(sexBucketOf('X')).toBe('X');
    });

    it('separates a recorded nonbinary value from an unrecorded one (#427)', () => {
        expect(sexBucketOf('X')).toBe('X');
        expect(sexBucketOf(null)).toBe('U');
        expect(sexBucketOf(undefined)).toBe('U');
        expect(sexBucketOf('')).toBe('U');
        expect(sexBucketOf('  ')).toBe('U');
    });

    it("treats GEDCOM's own U (undetermined) as unrecorded, not as nonbinary", () => {
        expect(sexBucketOf('U')).toBe('U');
        expect(sexBucketOf('u')).toBe('U');
    });

    it('files any other recorded code under the nonbinary/other bucket', () => {
        expect(sexBucketOf('N')).toBe('X');
    });
});

describe('matchesSexBucket', () => {
    it('matches only its own bucket', () => {
        expect(matchesSexBucket('X', 'X')).toBe(true);
        expect(matchesSexBucket('X', null)).toBe(false);
        expect(matchesSexBucket('U', null)).toBe(true);
        expect(matchesSexBucket('U', 'X')).toBe(false);
        expect(matchesSexBucket('M', 'F')).toBe(false);
    });
});

describe('sexBucketsPresent', () => {
    it('offers only the buckets that match someone', () => {
        expect(sexBucketsPresent([{ Sex: 'M' }, { Sex: 'F' }])).toEqual(['M', 'F']);
    });

    it('offers the unrecorded bucket when someone has no recorded sex', () => {
        expect(sexBucketsPresent([{ Sex: 'M' }, { Sex: null }])).toEqual(['M', 'U']);
    });

    it('offers nonbinary and unrecorded as separate steps in the cycle', () => {
        expect(sexBucketsPresent([{ Sex: 'X' }, { Sex: null }])).toEqual(['X', 'U']);
    });

    it('returns an empty list for no people', () => {
        expect(sexBucketsPresent([])).toEqual([]);
    });

    it('returns the buckets in display order regardless of input order', () => {
        expect(sexBucketsPresent([{ Sex: undefined }, { Sex: 'X' }, { Sex: 'F' }, { Sex: 'M' }])).toEqual(['M', 'F', 'X', 'U']);
    });
});
