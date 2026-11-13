import { describe, expect, it } from 'vitest';
import { classifyPrChanges } from '../../scripts/lib/pr-changes.mjs';

const pkg = (version: string, deps: Record<string, string> = { next: '16.0.0' }) =>
  JSON.stringify({ name: 'heirloom', version, dependencies: deps }, null, 2);

const lock = (version: string, deps: Record<string, string> = { next: '16.0.0' }) =>
  JSON.stringify({
    name: 'heirloom',
    version,
    lockfileVersion: 3,
    packages: {
      '': { name: 'heirloom', version, dependencies: deps },
      'node_modules/next': { version: deps.next },
    },
  }, null, 2);

function reader(base: Record<string, string>, head: Record<string, string>) {
  return (path: string, side: 'base' | 'head') => (side === 'base' ? base : head)[path] ?? null;
}

describe('classifyPrChanges (#75)', () => {
  it('marks a pure version bump as version-only', () => {
    const read = reader(
      { 'package.json': pkg('1.0.0'), 'package-lock.json': lock('1.0.0') },
      { 'package.json': pkg('1.1.0'), 'package-lock.json': lock('1.1.0') },
    );
    expect(classifyPrChanges(['package.json', 'package-lock.json'], read)).toEqual({ versionOnly: true, docsOnly: false });
  });

  it('runs everything when a dependency changes alongside the bump', () => {
    const read = reader(
      { 'package.json': pkg('1.0.0'), 'package-lock.json': lock('1.0.0') },
      { 'package.json': pkg('1.1.0', { next: '16.1.0' }), 'package-lock.json': lock('1.1.0', { next: '16.1.0' }) },
    );
    expect(classifyPrChanges(['package.json', 'package-lock.json'], read).versionOnly).toBe(false);
  });

  it('runs everything when only the lock file hides a change', () => {
    const headLock = JSON.parse(lock('1.1.0'));
    headLock.packages['node_modules/next'].version = '16.0.1';
    const read = reader(
      { 'package.json': pkg('1.0.0'), 'package-lock.json': lock('1.0.0') },
      { 'package.json': pkg('1.1.0'), 'package-lock.json': JSON.stringify(headLock) },
    );
    expect(classifyPrChanges(['package.json', 'package-lock.json'], read).versionOnly).toBe(false);
  });

  it('runs everything when another file changes too', () => {
    const read = reader(
      { 'package.json': pkg('1.0.0'), 'package-lock.json': lock('1.0.0') },
      { 'package.json': pkg('1.1.0'), 'package-lock.json': lock('1.1.0') },
    );
    expect(classifyPrChanges(['package.json', 'package-lock.json', 'app/page.tsx'], read).versionOnly).toBe(false);
  });

  it('treats an unreadable or invalid file as a real change', () => {
    const read = reader({ 'package.json': pkg('1.0.0') }, { 'package.json': pkg('1.1.0'), 'package-lock.json': '{' });
    expect(classifyPrChanges(['package.json', 'package-lock.json'], read).versionOnly).toBe(false);
  });

  it('marks Markdown and docs/ changes as docs-only', () => {
    const read = reader({}, {});
    expect(classifyPrChanges(['README.md', 'docs/decisions/0048-x.md', 'docs/diagram.svg'], read).docsOnly).toBe(true);
    expect(classifyPrChanges(['README.md', 'app/page.tsx'], read).docsOnly).toBe(false);
    expect(classifyPrChanges([], read).docsOnly).toBe(false);
  });
});
