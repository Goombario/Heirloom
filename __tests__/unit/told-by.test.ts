import { describe, it, expect } from 'vitest';
import { foldToldBy } from '@/lib/utils/told-by';

describe('foldToldBy (#470)', () => {
    it('gives an empty author the teller', () => {
        expect(foldToldBy(null, 'Grandma Rose')).toBe('Grandma Rose');
        expect(foldToldBy(' ', ' Grandma Rose ')).toBe('Grandma Rose');
    });

    it('names the teller after a different author', () => {
        expect(foldToldBy('Anna Petrova', 'Ivan')).toBe('Anna Petrova (told by Ivan)');
        // Tabs and line breaks trim as in the v65 migration's SQL.
        expect(foldToldBy('\tParish clerk', 'Rose\n')).toBe('\tParish clerk (told by Rose)');
    });

    it('leaves the author alone with no teller or the same one', () => {
        expect(foldToldBy('Parish clerk', null)).toBe('Parish clerk');
        expect(foldToldBy('Parish clerk', undefined)).toBe('Parish clerk');
        expect(foldToldBy('Parish clerk', '  ')).toBe('Parish clerk');
        expect(foldToldBy('Ivan', 'Ivan')).toBe('Ivan');
        expect(foldToldBy(null, null)).toBeNull();
    });
});
