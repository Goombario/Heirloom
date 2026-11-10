import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { walk } from '../../scripts/audit/fs-walk.mjs';
import { hasMessage, scanTranslationKeys, type DynamicUse, type KeyUse } from '../../scripts/audit/i18n-used-keys';

/**
 * #790 (task audit M-1): every literal key passed to a translator must exist
 * in en, fr and ru. The place page's mobile Edit button read the raw key
 * `places.edit_place` because the key existed in no locale, and nothing failed.
 * Dynamic keys (template literals, variables) can't be checked here; they're
 * listed in the output instead.
 */
const ROOT = join(__dirname, '../..');
const LOCALES = ['en', 'fr', 'ru'] as const;
const catalogs = Object.fromEntries(
    LOCALES.map(l => [l, JSON.parse(readFileSync(join(ROOT, 'messages', `${l}.json`), 'utf8'))]),
) as Record<(typeof LOCALES)[number], unknown>;

function missingKeys(uses: KeyUse[]): string[] {
    return uses.flatMap(u => LOCALES
        .filter(l => !hasMessage(catalogs[l], u.key))
        .map(l => `${u.file}:${u.line} ${u.key} (missing in ${l})`));
}

describe('i18n: translator keys exist in every locale', () => {
    it('finds no literal key missing from en, fr or ru', () => {
        const uses: KeyUse[] = [];
        const dynamic: DynamicUse[] = [];
        for (const dir of ['app', 'lib']) {
            for (const path of (walk(join(ROOT, dir), ['.ts', '.tsx']) as string[]).filter(p => !p.endsWith('.d.ts'))) {
                const result = scanTranslationKeys(relative(ROOT, path), readFileSync(path, 'utf8'));
                uses.push(...result.uses);
                dynamic.push(...result.dynamic);
            }
        }
        // A scan that finds nothing is a broken scan, not a clean codebase.
        expect(uses.length).toBeGreaterThan(1000);
        console.info(`i18n key gate: ${uses.length} literal keys checked; ${dynamic.length} dynamic keys not checked:\n`
            + dynamic.map(d => `  ${d.file}:${d.line} ${d.namespace}.(${d.expression})`).join('\n'));
        expect(missingKeys(uses)).toEqual([]);
    });
});

describe('scanTranslationKeys', () => {
    const scan = (source: string) => scanTranslationKeys('x.tsx', source);

    it('fails on a key that is missing from a locale', () => {
        const { uses } = scan(`function A() { const t = useTranslations('places'); return t('no_such_key_anywhere'); }`);
        expect(missingKeys(uses)).toEqual([
            'x.tsx:1 places.no_such_key_anywhere (missing in en)',
            'x.tsx:1 places.no_such_key_anywhere (missing in fr)',
            'x.tsx:1 places.no_such_key_anywhere (missing in ru)',
        ]);
    });

    it('resolves each translator to its own namespace, and respects shadowing', () => {
        const { uses, dynamic } = scan(`
            function A() {
                const t = useTranslations('places');
                const tc = useTranslations('common');
                const helper = (t: Translator) => t('not_places');
                return [t('edit_place'), tc('cancel'), t.rich('rich_key'), t.has('guarded'), t(ok ? 'a' : 'b'), t(\`dyn_\${x}\`)];
            }
            function B() { const t = useTranslations('home'); return t('title'); }
        `);
        expect(uses.map(u => u.key)).toEqual([
            'places.edit_place', 'common.cancel', 'places.rich_key', 'places.a', 'places.b', 'home.title',
        ]);
        expect(dynamic.map(d => `${d.namespace}:${d.expression}`)).toEqual(['places:`dyn_${x}`']);
    });
});
