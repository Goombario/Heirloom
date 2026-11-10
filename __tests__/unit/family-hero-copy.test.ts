import { describe, it, expect } from 'vitest';
import {
  partnershipKindKey,
  partnerShortName, shortNameFromDisplay, sortChildrenByBirth, heroTitleParts, heroSubtitleParts, heroCopy,
} from '@/app/families/view/derive';

// Same stand-in translator FamilySummaryView.test.tsx uses: returns "key(arg=value,…)"
// so assertions can check both the stable key and the interpolated values.
const t = (key: string, args?: Record<string, unknown>) =>
  args ? `${key}(${Object.entries(args).map(([k, v]) => `${k}=${v}`).join(',')})` : key;

describe('partnerShortName', () => {
  it('uses the primary given name, not the nickname (#796, ED-11)', () => {
    expect(partnerShortName({ FirstName: 'Edmund Ashby', LastName: 'Thornbury', Nickname: 'Ned' })).toBe('Edmund');
    expect(partnerShortName({ FirstName: 'Николай', EffectiveFirstName: 'Коля', LastName: 'Попов', Nickname: 'Коля' })).toBe('Николай');
  });
  it('falls back to the first given name', () => {
    expect(partnerShortName({ FirstName: 'Walter Percy', LastName: 'Thornbury' })).toBe('Walter');
  });
  it('uses the effective first name when there is no raw FirstName', () => {
    expect(partnerShortName({ FirstName: null, EffectiveFirstName: 'Edith Ann', LastName: 'Croft' })).toBe('Edith');
  });
  it('returns the surname when there is no given name at all', () => {
    expect(partnerShortName({ FirstName: null, LastName: 'Croft' })).toBe('Croft');
  });
  it('returns empty string for null or a wholly nameless person', () => {
    expect(partnerShortName(null)).toBe('');
    expect(partnerShortName({ FirstName: null, LastName: null })).toBe('');
  });
});

describe('shortNameFromDisplay', () => {
  it('skips an integrated nickname and takes the first given name (#796)', () => {
    expect(shortNameFromDisplay('Edmund "Ned" Ashby Thornbury')).toBe('Edmund');
  });
  it('falls back to the first word', () => {
    expect(shortNameFromDisplay('Walter Percy Thornbury')).toBe('Walter');
  });
  it('returns empty string for null or blank', () => {
    expect(shortNameFromDisplay(null)).toBe('');
    expect(shortNameFromDisplay('   ')).toBe('');
  });
});

describe('heroTitleParts', () => {
  it('joins both partners', () => {
    expect(heroTitleParts('Walter', 'Edith')).toEqual({ key: 'hero_title_both', a: 'Walter', b: 'Edith' });
  });
  it('degrades to the one known partner, whichever side', () => {
    expect(heroTitleParts('Walter', '')).toEqual({ key: 'hero_title_one', a: 'Walter' });
    expect(heroTitleParts('', 'Edith')).toEqual({ key: 'hero_title_one', a: 'Edith' });
  });
  it('falls back when neither partner is known', () => {
    expect(heroTitleParts('', '')).toEqual({ key: 'family_fallback' });
  });
});

describe('heroSubtitleParts', () => {
  it('phrases each type naturally with a place', () => {
    expect(heroSubtitleParts('Marriage', 'Congregational Church, Dover'))
      .toEqual({ key: 'subtitle_marriage_at', place: 'Congregational Church, Dover' });
    expect(heroSubtitleParts('Civil union', 'Dover')).toEqual({ key: 'subtitle_civil_union_at', place: 'Dover' });
    expect(heroSubtitleParts('Common-law', 'Dover')).toEqual({ key: 'subtitle_common_law_at', place: 'Dover' });
    expect(heroSubtitleParts('Other', 'Dover')).toEqual({ key: 'subtitle_partnership_at', place: 'Dover' });
    expect(heroSubtitleParts('Unknown', 'Dover')).toEqual({ key: 'subtitle_partnership_at', place: 'Dover' });
    expect(heroSubtitleParts(null, 'Dover')).toEqual({ key: 'subtitle_partnership_at', place: 'Dover' });
  });
  it('drops to type-only when there is no place', () => {
    expect(heroSubtitleParts('Marriage', null)).toEqual({ key: 'subtitle_marriage' });
    expect(heroSubtitleParts('Common-law', '  ')).toEqual({ key: 'subtitle_common_law' });
  });
  it('renders nothing when neither a known type nor a place exists', () => {
    expect(heroSubtitleParts(null, null)).toBeNull();
    expect(heroSubtitleParts('Unknown', '')).toBeNull();
  });
});

describe('heroCopy', () => {
  it('collapses both-partner title parts and a placed subtitle', () => {
    expect(heroCopy(
      heroTitleParts('Walter', 'Edith'),
      heroSubtitleParts('Marriage', 'Dover'),
      t,
    )).toEqual({ title: 'hero_title_both(a=Walter,b=Edith)', subtitle: 'subtitle_marriage_at(place=Dover)' });
  });
  it('collapses the one-known-partner title', () => {
    expect(heroCopy(heroTitleParts('Walter', ''), null, t))
      .toEqual({ title: 'hero_title_one(a=Walter)', subtitle: '' });
  });
  it('collapses the fallback title and a type-only subtitle', () => {
    expect(heroCopy(heroTitleParts('', ''), heroSubtitleParts('Marriage', null), t))
      .toEqual({ title: 'family_fallback', subtitle: 'subtitle_marriage' });
  });
  it('renders an empty subtitle when there are no subtitle parts', () => {
    expect(heroCopy(heroTitleParts('Walter', 'Edith'), null, t).subtitle).toBe('');
  });
});

describe('partnershipKindKey', () => {
  it('names each partnership type in its own terms', () => {
    expect(partnershipKindKey('Marriage')).toBe('marriage_kind');
    expect(partnershipKindKey('Civil union')).toBe('civil_union_kind');
    expect(partnershipKindKey('Common-law')).toBe('common_law_kind');
  });
  it('falls back to the neutral kind for Other/Unknown/null', () => {
    expect(partnershipKindKey('Other')).toBe('partnership_kind');
    expect(partnershipKindKey('Unknown')).toBe('partnership_kind');
    expect(partnershipKindKey(null)).toBe('partnership_kind');
    expect(partnershipKindKey(undefined)).toBe('partnership_kind');
  });
});

describe('sortChildrenByBirth (#796, ED-11)', () => {
  it('orders by birth year, approximate dates by their year, undated last', () => {
    const kids = [
      { Id: 1, BirthDate: '1843' },
      { Id: 2, BirthDate: '1849-06-02' },
      { Id: 5, BirthDate: null },
      { Id: 3, BirthDate: '1849-02-10' },
      { Id: 4, BirthDate: 'ABT 1846' },
    ];
    expect(sortChildrenByBirth(kids).map((k) => k.Id)).toEqual([1, 4, 3, 2, 5]);
  });
  it('keeps the stored order for ties and does not mutate its input', () => {
    const kids = [{ Id: 1, BirthDate: null }, { Id: 2, BirthDate: '1850' }, { Id: 3, BirthDate: null }];
    expect(sortChildrenByBirth(kids).map((k) => k.Id)).toEqual([2, 1, 3]);
    expect(kids.map((k) => k.Id)).toEqual([1, 2, 3]);
  });
});
