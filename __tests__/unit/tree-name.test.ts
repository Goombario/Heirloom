import { describe, it, expect } from 'vitest';
import { DEFAULT_TREE_NAME, treeDisplayName } from '@/lib/utils/tree-name';

describe('treeDisplayName', () => {
    it('translates only the untouched stored default (#704)', () => {
        expect(treeDisplayName(DEFAULT_TREE_NAME, 'Mon arbre')).toBe('Mon arbre');
        expect(treeDisplayName('Arbor family', 'Mon arbre')).toBe('Arbor family');
        expect(treeDisplayName('my tree', 'Mon arbre')).toBe('my tree');
    });
    it('passes a missing name through', () => {
        expect(treeDisplayName(null, 'Mon arbre')).toBeNull();
    });
});
