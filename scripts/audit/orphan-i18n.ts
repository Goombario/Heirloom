import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { walk } from './fs-walk.mjs';
import { scanTranslationKeys, type DynamicUse, type KeyUse } from './i18n-used-keys';

/**
 * Orphaned message keys (#256): keys in messages/en.json that no code appears to
 * use. A census, never a gate: keys built at run time can't be proved used, so
 * every candidate needs a person to confirm it before deletion.
 *
 * A key is
 * - **used** when a resolved translator names it literally (`t('key')`, see
 *   i18n-used-keys.ts), or names an object above it (`t.raw('group')`);
 * - **dynamic** when a template key could build it (`t(\`status_${s}\`)` covers
 *   every `status_*` key in that namespace), or its last segment appears as a
 *   quoted string anywhere in app/ or lib/ (key lists such as
 *   `['marriage', 'divorce']`, translators passed as props, `t.has('key')`);
 * - an **orphan candidate** otherwise.
 */

export interface OrphanCensus {
    total: number;
    used: number;
    dynamic: number;
    orphans: string[];
}

/** Every string leaf of a message catalog, as `a.b.c` paths. */
export function messageKeys(catalog: unknown, prefix = ''): string[] {
    if (!catalog || typeof catalog !== 'object') return [];
    return Object.entries(catalog as Record<string, unknown>).flatMap(([k, v]) => {
        const path = prefix ? `${prefix}.${k}` : k;
        return typeof v === 'string' ? [path] : messageKeys(v, path);
    });
}

/** The fixed text a template key starts with, as a full-path prefix; null for any other dynamic key. */
export function dynamicPrefix(use: Pick<DynamicUse, 'namespace' | 'expression'>): string | null {
    const match = /^`([^`$]*)\$\{/.exec(use.expression.trim());
    return match ? `${use.namespace}.${match[1]}` : null;
}

function quotedTokens(corpus: string): Set<string> {
    const tokens = new Set<string>();
    for (const m of corpus.matchAll(/(['"`])([A-Za-z0-9_.-]+)\1/g)) tokens.add(m[2]);
    return tokens;
}

export function findOrphanMessageKeys(input: {
    catalog: unknown;
    uses: Pick<KeyUse, 'key'>[];
    dynamic: Pick<DynamicUse, 'namespace' | 'expression'>[];
    corpus: string;
}): OrphanCensus {
    const keys = messageKeys(input.catalog);
    const named = new Set(input.uses.map((u) => u.key));
    const prefixes = input.dynamic.map(dynamicPrefix).filter((p): p is string => p !== null);
    const tokens = quotedTokens(input.corpus);
    let used = 0;
    let dynamic = 0;
    const orphans: string[] = [];
    for (const key of keys) {
        const parts = key.split('.');
        if (parts.some((_, i) => named.has(parts.slice(0, i + 1).join('.')))) used++;
        else if (prefixes.some((p) => key.startsWith(p)) || tokens.has(parts[parts.length - 1])) dynamic++;
        else orphans.push(key);
    }
    return { total: keys.length, used, dynamic, orphans };
}

/** Scan app/ and lib/ against messages/en.json from `root`. */
export function censusOrphanMessageKeys(root = process.cwd()): OrphanCensus {
    const uses: KeyUse[] = [];
    const dynamic: DynamicUse[] = [];
    const sources: string[] = [];
    for (const dir of ['app', 'lib']) {
        for (const file of (walk(join(root, dir), ['.ts', '.tsx']) as string[]).filter((p) => !p.endsWith('.d.ts'))) {
            const source = readFileSync(file, 'utf8');
            sources.push(source);
            const result = scanTranslationKeys(relative(root, file), source);
            uses.push(...result.uses);
            dynamic.push(...result.dynamic);
        }
    }
    const catalog = JSON.parse(readFileSync(join(root, 'messages', 'en.json'), 'utf8')) as unknown;
    return findOrphanMessageKeys({ catalog, uses, dynamic, corpus: sources.join('\n') });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { total, used, dynamic, orphans } = censusOrphanMessageKeys();
    console.log(`Orphaned message key candidates: ${orphans.length}/${total} (${used} used by name, ${dynamic} possibly built at run time)`);
    console.log('  NOTE: candidates only. Confirm each is unused before deleting it from en, fr and ru.');
    for (const key of orphans) console.log(`  ${key}`);
}
