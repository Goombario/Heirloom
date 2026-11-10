import { describe, expect, it } from 'vitest';
import { dynamicPrefix, findOrphanMessageKeys, messageKeys } from '../../scripts/audit/orphan-i18n';

describe('orphaned message key census (#256)', () => {
  const catalog = {
    cases: { status_open: 'Open', status_closed: 'Closed', title: 'Cases', stale: 'Old' },
    events: { kinds: { marriage: 'Marriage', divorce: 'Divorce' } },
    nav: { primary_navigation: 'Primary' },
  };

  it('lists every string leaf as a full path', () => {
    expect(messageKeys(catalog)).toEqual([
      'cases.status_open', 'cases.status_closed', 'cases.title', 'cases.stale',
      'events.kinds.marriage', 'events.kinds.divorce', 'nav.primary_navigation',
    ]);
  });

  it('turns a template key into a namespace prefix, and nothing else into one', () => {
    expect(dynamicPrefix({ namespace: 'cases', expression: '`status_${s}`' })).toBe('cases.status_');
    expect(dynamicPrefix({ namespace: 'cases', expression: 'labelKey' })).toBeNull();
  });

  it('reports only keys that are neither named, built from a template, nor quoted anywhere', () => {
    const census = findOrphanMessageKeys({
      catalog,
      uses: [{ key: 'cases.title' }, { key: 'events.kinds' }],
      dynamic: [{ namespace: 'cases', expression: '`status_${status}`' }],
      corpus: `const t = useTranslations('cases'); t('title'); const unrelated = 'stale_value';`,
    });
    expect(census).toEqual({ total: 7, used: 3, dynamic: 2, orphans: ['cases.stale', 'nav.primary_navigation'] });
  });

  it('counts a key whose last segment is quoted somewhere as possibly used', () => {
    const census = findOrphanMessageKeys({ catalog, uses: [], dynamic: [], corpus: `const k = 'stale';` });
    expect(census.orphans).not.toContain('cases.stale');
  });
});
