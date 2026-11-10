import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { endedLabel, partnerNameLines, PartnerNameLines } from '@/app/families/FamiliesPageClient';
import { earlierDeathYear, familyDurationYears } from '@/app/families/familyList';
import type { FamilyWithSpouseNames } from '@/lib/db/queries/families';

// Same stand-in translator pattern as family-hero-copy.test.ts: returns
// "key(arg=value,…)" so assertions can check both the stable key and the
// interpolated values without a real next-intl provider.
const t = (key: string, args?: Record<string, unknown>) =>
  args ? `${key}(${Object.entries(args).map(([k, v]) => `${k}=${v}`).join(',')})` : key;

function family(partial: Partial<FamilyWithSpouseNames>): FamilyWithSpouseNames {
  return {
    Id: 1,
    MarriageDate: null,
    MarriagePlace: null,
    EndedDate: null,
    EndedReason: null,
    Type: 'Marriage',
    husbandName: 'Walter Thornbury',
    wifeName: 'Edith Thornbury',
    partner1DeathDate: null,
    partner2DeathDate: null,
    partner1Sex: 'M',
    partner2Sex: 'F',
    husbandMediaId: null,
    wifeMediaId: null,
    husbandFocalX: null,
    husbandFocalY: null,
    husbandFocalRadius: null,
    wifeFocalX: null,
    wifeFocalY: null,
    wifeFocalRadius: null,
    ...partial,
  } as unknown as FamilyWithSpouseNames;
}

// Pull the text out of the element endedLabel returns, without a DOM render.
function badgeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(badgeText).join('');
  return badgeText((node as { props?: { children?: ReactNode } }).props?.children);
}

describe('earlierDeathYear', () => {
  it('resolves qualified/ranged dates by their real bound, not a digit match', () => {
    expect(earlierDeathYear('ABT 1980', 'ABT 1975')).toBe(1975);
    expect(earlierDeathYear('TO 1880', null)).toBe(1880);
  });
  it('returns whichever side has a year, or null when neither does', () => {
    expect(earlierDeathYear('1980', null)).toBe(1980);
    expect(earlierDeathYear(null, null)).toBeNull();
  });
});

describe('endedLabel — derived-death branch with a qualified death date', () => {
  it('renders the ended-by-death badge, not "Active", for an ABT partner death', () => {
    const f = family({ partner1DeathDate: 'ABT 1950' });
    const node = endedLabel(f, t as never);
    expect(badgeText(node)).toContain('ended_death_of');
    expect(badgeText(node)).not.toBe('active_pill');
  });
  it('still shows Active when neither partner has a death date', () => {
    const f = family({});
    const node = endedLabel(f, t as never);
    expect(badgeText(node)).toBe('active_pill');
  });
  it('shows the year as a plain year, never grouped like a number', () => {
    const f = family({ partner1DeathDate: '1880' });
    expect(badgeText(endedLabel(f, t as never))).toMatch(/^1880 · /);
  });

  it('picks the earlier-dying partner by name across two qualified dates', () => {
    const f = family({ partner1DeathDate: 'ABT 1980', partner2DeathDate: 'ABT 1975' });
    const node = endedLabel(f, t as never);
    expect(badgeText(node)).toContain('name=Edith');
    expect(badgeText(node)).toMatch(/^1975 · /);
  });
});

describe('familyDurationYears — duration badge with qualified dates', () => {
  it('computes a real yearsCount for a qualified marriage date against an active family', () => {
    const f = family({ MarriageDate: 'ABT 1900' });
    const { yearsCount, startYear } = familyDurationYears(f, true, 1950);
    expect(startYear).toBe('~1900');
    expect(yearsCount).toBe(50);
  });
  it('computes a real yearsCount for a qualified marriage + derived death end', () => {
    const f = family({ MarriageDate: 'ABT 1900', partner1DeathDate: 'ABT 1950' });
    const { yearsCount, endYear } = familyDurationYears(f, false, 2024);
    expect(endYear).toBe('1950');
    expect(yearsCount).toBe(50);
  });
  it('does not silently drop the badge (null) when EndedDate itself is qualified', () => {
    const f = family({ MarriageDate: '1900', EndedDate: 'ABT 1950' });
    const { yearsCount } = familyDurationYears(f, false, 2024);
    expect(yearsCount).toBe(50);
  });
  it('drops a derived end that falls before the start, with no negative duration (#826)', () => {
    const f = family({ MarriageDate: 'EST 1842', partner1DeathDate: '27 JAN 1814', partner2DeathDate: '1871' });
    const { startYear, endYear, yearsCount } = familyDurationYears(f, false, 2024);
    expect(startYear).toBe('~1842');
    expect(endYear).toBeNull();
    expect(yearsCount).toBeNull();
  });
});

describe('partnerNameLines — one partner per line (#483)', () => {
  it('keeps both full names, one per line, rather than joining them', () => {
    expect(partnerNameLines('Barnaby "Barn" Quill Ashdown', 'Rosalind "Ros" Maude Kettering'))
      .toEqual(['Barnaby "Barn" Quill Ashdown', 'Rosalind "Ros" Maude Kettering']);
  });

  // Both surfaces derive from the same helper now: the mobile card used to show
  // surnames joined by " & " while the desktop table showed full names joined
  // by " + ".
  it('trims and drops a missing partner instead of leaving a dangling joiner', () => {
    expect(partnerNameLines('  Walter Thornbury  ', null)).toEqual(['Walter Thornbury']);
    expect(partnerNameLines(null, 'Edith Thornbury')).toEqual(['Edith Thornbury']);
    expect(partnerNameLines('', '   ')).toEqual([]);
    expect(partnerNameLines(undefined, undefined)).toEqual([]);
  });
});

describe('PartnerNameLines', () => {
  function lineTexts(node: ReactNode): string[] {
    const el = node as { props?: { children?: unknown } };
    const kids = el?.props?.children;
    const arr = Array.isArray(kids) ? kids : [kids];
    return arr.map((k) => String((k as { props?: { children?: unknown } })?.props?.children ?? ''));
  }

  it('marks the second line with the ampersand so the pair still reads as one union', () => {
    expect(lineTexts(PartnerNameLines({ lines: ['Walter Thornbury', 'Edith Thornbury'], fallback: 'f' })))
      .toEqual(['Walter Thornbury', '& Edith Thornbury']);
  });

  it('renders a lone partner with no ampersand', () => {
    expect(lineTexts(PartnerNameLines({ lines: ['Walter Thornbury'], fallback: 'f' }))).toEqual(['Walter Thornbury']);
  });

  it('falls back to the caller-supplied label when neither partner is named', () => {
    const node = PartnerNameLines({ lines: [], fallback: 'partnership_fallback(id=7)' });
    expect(String((node as { props?: { children?: unknown } })?.props?.children)).toBe('partnership_fallback(id=7)');
  });
});

// #757: the Ended cell is text, a `.date-mono` year and muted words, never a
// tag on every row. (#702 kept a death out of the red error tone; with no tag
// there's no tone at all.)
describe('endedLabel — text, not a tag', () => {
  const isBadge = (node: ReactNode) => !!(node as { props?: { tone?: string } }).props?.tone;

  it.each([
    ['a derived death', family({ partner1DeathDate: '1880-01-01' })],
    ['an explicit death end', family({ EndedReason: 'Death', EndedDate: '1880' })],
    ['a divorce', family({ EndedReason: 'Divorce' as never })],
    ['an active partnership', family({})],
  ])('renders %s as text', (_, f) => {
    expect(isBadge(endedLabel(f, t as never))).toBe(false);
  });

  it('sets the year in the muted date face (#935)', () => {
    const node = endedLabel(family({ EndedReason: 'Death', EndedDate: '1880' }), t as never) as { props: { children: ReactNode[] } };
    const year = (node.props.children[0] as { props: { children: ReactNode[] } }).props.children[0] as { props: { className: string; children: string } };
    expect(year.props).toMatchObject({ className: 'date-mono date-muted', children: '1880' });
  });
});
