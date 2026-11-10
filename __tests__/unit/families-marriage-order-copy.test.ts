import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import ru from '@/messages/ru.json';

// #757: marriage order reads in words, so "X of Y" means sourcing only.
describe('Families marriage-order sub-line', () => {
    it.each([
        ['en', en, "Aster's 1st marriage of 2", "Aster's 2nd partnership of 3"],
        ['fr', fr, 'Aster : 1er mariage sur 2', 'Aster : 2e union sur 3'],
        ['ru', ru, 'Aster: 1-й брак из 2', 'Aster: 2-й союз из 3'],
    ])('%s', (locale, messages, marriage, partnership) => {
        const t = createTranslator({ locale, messages, namespace: 'families' });
        expect(t('seq_marriage', { name: 'Aster', rank: 1, total: 2 })).toBe(marriage);
        expect(t('seq_partnership', { name: 'Aster', rank: 2, total: 3 })).toBe(partnership);
    });
});
