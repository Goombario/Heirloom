import { describe, it, expect } from 'vitest';
import {
  extractCssClassSelectors,
  isClassReferenced,
  rankOversized,
  diffKnip,
  knipIssueKeys,
} from '../../scripts/audit/lib.mjs';

describe('extractCssClassSelectors', () => {
  it('pulls unique class names from selectors', () => {
    const css = '.btn-primary { color: red } .card { } .btn-primary:hover { }';
    expect(extractCssClassSelectors(css).sort()).toEqual(['btn-primary', 'card']);
  });

  it('handles hyphenated and BEM-ish names', () => {
    expect(extractCssClassSelectors('.filter-chip__label {}')).toContain('filter-chip__label');
  });
});

describe('isClassReferenced', () => {
  it('matches a whole-token class in a className string', () => {
    expect(isClassReferenced('card', 'className="section card x"')).toBe(true);
  });

  it('does not match a partial substring', () => {
    expect(isClassReferenced('card', 'className="card-interactive"')).toBe(false);
    expect(isClassReferenced('btn', 'className="my-btn-thing"')).toBe(false);
  });

  it('returns false when absent', () => {
    expect(isClassReferenced('pill', 'className="badge"')).toBe(false);
  });
});

describe('rankOversized', () => {
  it('keeps files at/over threshold, sorted desc', () => {
    const files = [
      { file: 'a.tsx', lines: 100 },
      { file: 'b.tsx', lines: 500 },
      { file: 'c.tsx', lines: 400 },
    ];
    expect(rankOversized(files, 400)).toEqual([
      { file: 'b.tsx', lines: 500 },
      { file: 'c.tsx', lines: 400 },
    ]);
  });
});

describe('diffKnip', () => {
  it('returns only keys not present in baseline', () => {
    expect(diffKnip(['a', 'b'], ['a', 'b', 'c'])).toEqual(['c']);
  });

  it('returns empty when no new keys', () => {
    expect(diffKnip(['a', 'b', 'c'], ['a', 'b'])).toEqual([]);
  });
});

describe('knipIssueKeys', () => {
  it('captures unused files from entry.files (v6 regression guard)', () => {
    const report = {
      issues: [
        { file: 'lib/empty.ts', files: [{ name: 'lib/empty.ts' }] },
      ],
    };
    expect(knipIssueKeys(report)).toContain('file:lib/empty.ts');
  });

  it('captures exports with file prefix', () => {
    const report = {
      issues: [
        { file: 'lib/auth.ts', exports: [{ name: 'signIn' }] },
      ],
    };
    expect(knipIssueKeys(report)).toContain('exports:lib/auth.ts:signIn');
  });

  it('captures devDependencies with file prefix', () => {
    const report = {
      issues: [
        { file: 'package.json', devDependencies: [{ name: 'tailwindcss' }] },
      ],
    };
    expect(knipIssueKeys(report)).toContain('devDependencies:package.json:tailwindcss');
  });

  it('returns a sorted array', () => {
    const report = {
      issues: [
        { file: 'lib/auth.ts', exports: [{ name: 'signIn' }] },
        { file: 'lib/empty.ts', files: [{ name: 'lib/empty.ts' }] },
        { file: 'package.json', devDependencies: [{ name: 'tailwindcss' }] },
      ],
    };
    const keys = knipIssueKeys(report);
    expect(keys).toEqual([...keys].sort());
  });

  it('returns [] for empty or absent issues', () => {
    expect(knipIssueKeys({})).toEqual([]);
    expect(knipIssueKeys({ issues: [] })).toEqual([]);
  });
});
