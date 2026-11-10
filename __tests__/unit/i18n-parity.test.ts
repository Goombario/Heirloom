import { describe, it, expect } from 'vitest';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import ru from '@/messages/ru.json';

type Json = Record<string, unknown>;

function keyPaths(obj: Json, prefix = ''): string[] {
    const paths: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            paths.push(...keyPaths(value as Json, path));
        } else {
            paths.push(path);
        }
    }
    return paths.sort();
}

describe('i18n key parity', () => {
    const enKeys = keyPaths(en as Json);
    const frKeys = keyPaths(fr as Json);
    const ruKeys = keyPaths(ru as Json);

    it('fr has exactly the same keys as en', () => {
        expect(frKeys).toEqual(enKeys);
    });

    it('ru has exactly the same keys as en', () => {
        expect(ruKeys).toEqual(enKeys);
    });

    it('has no empty string values in any locale', () => {
        for (const [name, obj] of [['en', en], ['fr', fr], ['ru', ru]] as const) {
            for (const path of keyPaths(obj as Json)) {
                const value = path.split('.').reduce<unknown>((acc, k) => (acc as Json)?.[k], obj);
                expect(value, `${name}: ${path} is empty`).not.toBe('');
            }
        }
    });
});
