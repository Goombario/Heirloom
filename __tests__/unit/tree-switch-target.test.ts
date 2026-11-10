import { describe, expect, it } from 'vitest';
import { treeSwitchTarget } from '@/lib/tree-switch-target';

describe('treeSwitchTarget (#916)', () => {
    it.each([
        ['/people/view', '?id=4', '/people'],
        ['/families/view/', '?id=4', '/families'],
        ['/cases/view', '?id=2', '/cases'],
        ['/cases/new', '', '/cases'],
        ['/places/view', '?name=Dover', '/places'],
        ['/library/view', '?id=9', '/library?tab=sources'],
        ['/tree', '?rootId=12', '/tree'],
        ['/library', '?tab=photos&source=9', '/library?tab=photos'],
        ['/library', '?source=9', '/library'],
    ])('sends %s%s to %s', (path, search, target) => {
        expect(treeSwitchTarget(path, search)).toBe(target);
    });

    it.each([
        ['/people', '?q=ada'],
        ['/families', ''],
        ['/', ''],
        ['/options', ''],
        ['/data-checks', ''],
        ['/tree', ''],
        ['/library', '?tab=photos'],
    ])('keeps %s%s where it is', (path, search) => {
        expect(treeSwitchTarget(path, search)).toBeNull();
    });
});
