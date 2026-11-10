import { describe, it, expect } from 'vitest';
import { PROVES_GROUP_FROM, groupProvesRows } from '@/lib/library/proves-groups';

describe('groupProvesRows', () => {
    it('groups by label in label order and keeps row order inside a group', () => {
        const rows = [
            { id: 1, label: 'Residence' },
            { id: 2, label: 'Birth' },
            { id: 3, label: 'Residence' },
            { id: 4, label: 'Birth' },
            { id: 5, label: 'Marriage' },
        ];
        const groups = groupProvesRows(rows, (r) => r.label, 'en');
        expect(groups.map(([label, items]) => [label, items.map((r) => r.id)])).toEqual([
            ['Birth', [2, 4]],
            ['Marriage', [5]],
            ['Residence', [1, 3]],
        ]);
    });

    it('sorts labels with the given locale', () => {
        const groups = groupProvesRows([{ l: 'Émigration' }, { l: 'Naissance' }, { l: 'Décès' }], (r) => r.l, 'fr');
        expect(groups.map(([label]) => label)).toEqual(['Décès', 'Émigration', 'Naissance']);
    });

    it('groups from eight facts', () => {
        expect(PROVES_GROUP_FROM).toBe(8);
    });
});
