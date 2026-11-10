import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards messages/{en,fr,ru}.json — the i18n message catalogues.
 *
 * These files are plain JSON, so a duplicate key inside a namespace is silently
 * legal: JSON.parse keeps the last one and the earlier value vanishes with no
 * error anywhere in the pipeline. knip does not scan JSON and ESLint has no JSON
 * parser installed, so nothing else catches it. Four such duplicates shipped
 * undetected until PR #252.
 *
 * See docs/superpowers/specs/2026-07-10-i18n-message-guard-design.md.
 *
 * Adding a message? Add it to all three locales, with the same {named} args.
 * Adding a Russian plural? It needs one/few/many/other — `many` is the one people
 * forget, and omitting it silently falls back to `other` (wrong for 5, 6, 7 …).
 */

const LOCALES = ['en', 'fr', 'ru'] as const;
const SOURCE_LOCALE = 'en';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

// --- duplicate-detecting JSON parser -----------------------------------------
// JSON.parse cannot report duplicate keys (a reviver only sees the deduplicated
// object), and the message files are CRLF on disk, so the cheaper trick of
// asserting canonical formatting and scanning lines is a cross-platform trap.

function parseJsonWithDuplicates(text: string): { value: Json; duplicates: string[] } {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const duplicates: string[] = [];
  let i = 0;

  const fail = (msg: string): never => {
    throw new Error(`${msg} at index ${i}`);
  };

  const skipWs = () => {
    while (i < src.length && (src[i] === ' ' || src[i] === '\t' || src[i] === '\n' || src[i] === '\r')) i++;
  };

  const parseString = (): string => {
    if (src[i] !== '"') fail('expected string');
    i++;
    let out = '';
    while (i < src.length) {
      const c = src[i];
      if (c === '"') {
        i++;
        return out;
      }
      if (c === '\\') {
        i++;
        const esc = src[i++];
        if (esc === 'u') {
          out += String.fromCharCode(parseInt(src.slice(i, i + 4), 16));
          i += 4;
        } else {
          const simple: Record<string, string> = {
            '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
          };
          if (!(esc in simple)) fail(`bad escape \\${esc}`);
          out += simple[esc];
        }
        continue;
      }
      out += c;
      i++;
    }
    return fail('unterminated string');
  };

  const expectLiteral = (lit: string) => {
    if (src.slice(i, i + lit.length) !== lit) fail(`expected ${lit}`);
    i += lit.length;
  };

  const parseNumber = (): number => {
    const start = i;
    if (src[i] === '-') i++;
    while (i < src.length && /[0-9eE+\-.]/.test(src[i])) i++;
    const n = Number(src.slice(start, i));
    if (Number.isNaN(n)) fail('bad number');
    return n;
  };

  const parseValue = (path: string): Json => {
    skipWs();
    const c = src[i];
    if (c === '{') return parseObject(path);
    if (c === '[') return parseArray(path);
    if (c === '"') return parseString();
    if (c === 't') { expectLiteral('true'); return true; }
    if (c === 'f') { expectLiteral('false'); return false; }
    if (c === 'n') { expectLiteral('null'); return null; }
    return parseNumber();
  };

  const parseArray = (path: string): Json[] => {
    i++;
    const out: Json[] = [];
    skipWs();
    if (src[i] === ']') { i++; return out; }
    for (;;) {
      out.push(parseValue(`${path}[${out.length}]`));
      skipWs();
      if (src[i] === ',') { i++; continue; }
      if (src[i] === ']') { i++; return out; }
      fail('expected , or ]');
    }
  };

  const parseObject = (path: string): { [k: string]: Json } => {
    i++;
    const out: { [k: string]: Json } = {};
    const seen = new Set<string>();
    skipWs();
    if (src[i] === '}') { i++; return out; }
    for (;;) {
      skipWs();
      const key = parseString();
      const childPath = path ? `${path}.${key}` : key;
      if (seen.has(key)) duplicates.push(childPath);
      seen.add(key);
      skipWs();
      if (src[i] !== ':') fail('expected :');
      i++;
      out[key] = parseValue(childPath);
      skipWs();
      if (src[i] === ',') { i++; continue; }
      if (src[i] === '}') { i++; return out; }
      fail('expected , or }');
    }
  };

  skipWs();
  const value = parseValue('');
  skipWs();
  if (i !== src.length) fail('trailing content');
  return { value, duplicates };
}

function readLocale(locale: string) {
  const raw = readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8');
  return parseJsonWithDuplicates(raw);
}

function flattenMessages(value: Json, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [key, child] of Object.entries(value as { [k: string]: Json })) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') {
      out.set(path, child);
    } else if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      flattenMessages(child, path, out);
    } else {
      throw new Error(`Expected a string or nested object at "${path}", got ${typeof child}`);
    }
  }
  return out;
}

const MESSAGES: Record<string, Map<string, string>> = Object.fromEntries(
  LOCALES.map((locale) => [locale, flattenMessages(readLocale(locale).value)])
);

const TARGET_LOCALES = LOCALES.filter((l) => l !== SOURCE_LOCALE);

const LIBRARY_BULK_KEYS = [
  'library.select',
  'library.done',
  'library.selected_count',
  'library.select_all_results',
  'library.clear_selection',
  'library.delete_selected',
  'library.delete_selected_title',
  'library.delete_selected_body',
  'library.delete_selected_confirm',
  'library.deleting_selected',
  'library.delete_request_failed',
  'library.delete_failed_item',
  'library.retry_failed',
  'library.cleanup_warning',
  'library.photo_select',
  'library.photo_deselect',
  'library.photo_delete_failed',
] as const;

const LIBRARY_BULK_COUNT_KEYS = [
  'library.selected_count',
  'library.select_all_results',
  'library.delete_selected',
  'library.delete_selected_body',
  'library.cleanup_warning',
] as const;

// --- ICU scanner --------------------------------------------------------------
// Brace-balancing, because `places.confirm_merge_body` has {from}/{to} outside its
// plural and ru `library.mobile_count_line` has two sibling plurals.

interface IcuArgNode {
  arg: string;
  type: 'plural' | 'selectordinal' | 'select' | 'simple' | 'other';
  selectors: Set<string>;
}

function scanIcu(message: string): { args: Set<string>; plurals: IcuArgNode[] } {
  const args = new Set<string>();
  const plurals: IcuArgNode[] = [];
  let i = 0;

  const skipWs = () => {
    while (i < message.length && /\s/.test(message[i])) i++;
  };

  const readToken = (): string => {
    skipWs();
    const start = i;
    while (i < message.length && !/[\s,{}]/.test(message[i])) i++;
    return message.slice(start, i);
  };

  // Advance past a balanced { ... } group whose opening brace was already consumed.
  const skipBalanced = () => {
    let depth = 1;
    while (i < message.length && depth > 0) {
      if (message[i] === '{') depth++;
      else if (message[i] === '}') depth--;
      i++;
    }
  };

  // ICU: '' is a literal quote; ' before {, }, # or | opens a quoted literal run.
  // Any other ' is itself literal (so French "l'arbre" is left alone).
  const tryConsumeQuote = (): boolean => {
    if (message[i] !== "'") return false;
    const next = message[i + 1];
    if (next === "'") { i += 2; return true; }
    if (next === '{' || next === '}' || next === '#' || next === '|') {
      i += 2;
      const end = message.indexOf("'", i);
      i = end === -1 ? message.length : end + 1;
      return true;
    }
    i++;
    return true;
  };

  const parseBody = () => {
    while (i < message.length) {
      const c = message[i];
      if (c === '}') return;
      if (c === "'") { tryConsumeQuote(); continue; }
      if (c === '{') { i++; parseArg(); continue; }
      i++;
    }
  };

  const parseClauses = (selectors: Set<string>) => {
    for (;;) {
      skipWs();
      if (i >= message.length || message[i] === '}') { i++; return; }
      const selector = readToken();
      if (selector.startsWith('offset:')) continue;
      skipWs();
      if (message[i] !== '{') { skipBalanced(); return; }
      i++;
      selectors.add(selector);
      parseBody();
      if (message[i] === '}') i++;
    }
  };

  function parseArg() {
    const arg = readToken();
    if (arg) args.add(arg);
    skipWs();
    if (message[i] === '}') { i++; return; }
    if (message[i] !== ',') { skipBalanced(); return; }
    i++;
    const type = readToken();
    skipWs();
    if (message[i] === '}') { i++; return; } // e.g. {count, number}
    if (message[i] !== ',') { skipBalanced(); return; }
    i++;
    if (type === 'plural' || type === 'selectordinal') {
      const selectors = new Set<string>();
      parseClauses(selectors);
      plurals.push({ arg, type, selectors });
    } else if (type === 'select') {
      parseClauses(new Set<string>());
    } else {
      skipBalanced();
    }
  }

  parseBody();
  return { args, plurals };
}

/**
 * The categories a locale's plurals must cover.
 *
 * Reading `resolvedOptions().pluralCategories` is wrong: French *declares* `many`,
 * which only fires at 1,000,000+, so all 44 French plurals would be failed.
 * An integer sweep alone is also wrong: Russian never yields `other` for any
 * integer (`other` covers fractions), yet ICU requires an `other` clause always.
 * So: `other`, unioned with everything reachable from realistic integer counts.
 *
 *   en -> one, other        fr -> one, other        ru -> one, few, many, other
 */
function requiredPluralCategories(locale: string): Set<string> {
  const rules = new Intl.PluralRules(locale);
  const required = new Set<string>(['other']);
  for (let n = 0; n <= 1000; n++) required.add(rules.select(n));
  return required;
}

describe('i18n parseJsonWithDuplicates', () => {
  it('reports no duplicates for a clean object', () => {
    expect(parseJsonWithDuplicates('{"a":1,"b":2}').duplicates).toEqual([]);
  });

  it('reports a duplicate key at the top level', () => {
    expect(parseJsonWithDuplicates('{"a":1,"a":2}').duplicates).toEqual(['a']);
  });

  it('reports a nested duplicate with its dot-path', () => {
    const src = '{"ns":{"k":"first","k":"second"}}';
    expect(parseJsonWithDuplicates(src).duplicates).toEqual(['ns.k']);
  });

  it('keeps the last value, matching JSON.parse semantics', () => {
    const { value } = parseJsonWithDuplicates('{"a":1,"a":2}');
    expect(value).toEqual({ a: 2 });
  });

  it('does not mistake a brace inside a string value for structure', () => {
    const src = '{"a":"{count, plural, one {x} other {y}}","b":1}';
    expect(parseJsonWithDuplicates(src).duplicates).toEqual([]);
  });

  it('handles escaped quotes in keys and values', () => {
    const src = '{"a\\"b":"say \\"hi\\"","a\\"b":2}';
    expect(parseJsonWithDuplicates(src).duplicates).toEqual(['a"b']);
  });

  it('handles unicode escapes and does not treat \\\\ as escaping the closing quote', () => {
    const src = '{"a":"back\\\\","b":"\\u0441"}';
    const { value } = parseJsonWithDuplicates(src);
    expect(value).toEqual({ a: 'back\\', b: 'с' });
  });

  it('parses arrays, numbers, booleans and null', () => {
    const { value } = parseJsonWithDuplicates('{"a":[1,-2.5,1e3,true,false,null]}');
    expect(value).toEqual({ a: [1, -2.5, 1000, true, false, null] });
  });

  it('reports duplicates at different depths independently', () => {
    const src = '{"x":1,"x":2,"ns":{"y":1,"y":2}}';
    expect(parseJsonWithDuplicates(src).duplicates.sort()).toEqual(['ns.y', 'x']);
  });

  it('rejects trailing content', () => {
    expect(() => parseJsonWithDuplicates('{"a":1} junk')).toThrow();
  });
});

describe('i18n messages: no duplicate keys', () => {
  it.each(LOCALES)('%s.json has no duplicate keys', (locale) => {
    const { duplicates } = readLocale(locale);
    expect(duplicates).toEqual([]);
  });
});

describe('i18n messages: key-set parity', () => {
  it('the source locale has messages to compare against', () => {
    expect(MESSAGES[SOURCE_LOCALE].size).toBeGreaterThan(1000);
  });

  it.each(TARGET_LOCALES)('%s.json defines every key that en.json defines', (locale) => {
    const missing = [...MESSAGES[SOURCE_LOCALE].keys()].filter((k) => !MESSAGES[locale].has(k));
    expect(missing, `Missing from ${locale}.json: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(TARGET_LOCALES)('%s.json defines no key that en.json lacks', (locale) => {
    const extra = [...MESSAGES[locale].keys()].filter((k) => !MESSAGES[SOURCE_LOCALE].has(k));
    expect(extra, `Not in en.json but present in ${locale}.json: ${extra.join(', ')}`).toEqual([]);
  });
});

describe('i18n messages: translated Library bulk outcomes', () => {
  it.each(LOCALES)('%s.json defines all bulk-selection and deletion keys', (locale) => {
    const missing = LIBRARY_BULK_KEYS.filter((key) => !MESSAGES[locale].has(key));
    expect(missing, `Missing from ${locale}.json: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(LOCALES)('%s.json keeps count-aware bulk messages interpolated', (locale) => {
    const offenders = LIBRARY_BULK_COUNT_KEYS.filter((key) => !scanIcu(MESSAGES[locale].get(key)!).args.has('count'));
    expect(offenders, `Missing {count} in ${locale}.json: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('i18n scanIcu', () => {
  it('finds a simple argument', () => {
    expect([...scanIcu('Hello {name}!').args]).toEqual(['name']);
  });

  it('finds no argument in a plain string', () => {
    const { args, plurals } = scanIcu('Just text.');
    expect([...args]).toEqual([]);
    expect(plurals).toEqual([]);
  });

  it('extracts plural selectors', () => {
    const { plurals } = scanIcu('{count, plural, one {# item} other {# items}}');
    expect(plurals).toHaveLength(1);
    expect(plurals[0].arg).toBe('count');
    expect([...plurals[0].selectors].sort()).toEqual(['one', 'other']);
  });

  it('keeps =N exact matches out of the category set', () => {
    const { plurals } = scanIcu('{n, plural, =0 {none} one {# x} other {# xs}}');
    expect([...plurals[0].selectors].sort()).toEqual(['=0', 'one', 'other']);
  });

  it('finds args outside a plural alongside the plural arg', () => {
    const src = 'Rename "{from}" to "{to}". Updates {count, plural, one {# rec} other {# recs}}.';
    expect([...scanIcu(src).args].sort()).toEqual(['count', 'from', 'to']);
  });

  it('finds two sibling plurals', () => {
    const src = '{sources, plural, one {# s} other {# ss}} - {photos, plural, one {# p} other {# ps}}';
    const { args, plurals } = scanIcu(src);
    expect(plurals).toHaveLength(2);
    expect([...args].sort()).toEqual(['photos', 'sources']);
  });

  it('recurses into clause bodies to find nested args', () => {
    const src = '{count, plural, one {one item for {name}} other {# items for {name}}}';
    expect([...scanIcu(src).args].sort()).toEqual(['count', 'name']);
  });

  it('skips an offset token', () => {
    const { plurals } = scanIcu('{n, plural, offset:1 one {# x} other {# xs}}');
    expect([...plurals[0].selectors].sort()).toEqual(['one', 'other']);
  });

  it('treats a bare apostrophe as a literal, not an escape', () => {
    expect([...scanIcu("l'arbre de {name}").args]).toEqual(['name']);
  });

  it('does not report select clauses as plurals', () => {
    const { plurals, args } = scanIcu('{g, select, male {he} female {she} other {they}}');
    expect(plurals).toEqual([]);
    expect([...args]).toEqual(['g']);
  });
});

describe('i18n requiredPluralCategories', () => {
  it('requires one/other for English', () => {
    expect([...requiredPluralCategories('en')].sort()).toEqual(['one', 'other']);
  });

  it('does not require `many` for French, despite it being a declared category', () => {
    expect([...requiredPluralCategories('fr')].sort()).toEqual(['one', 'other']);
    expect(new Intl.PluralRules('fr').resolvedOptions().pluralCategories).toContain('many');
  });

  it('requires one/few/many/other for Russian', () => {
    expect([...requiredPluralCategories('ru')].sort()).toEqual(['few', 'many', 'one', 'other']);
  });
});

describe('i18n messages: ICU plurals', () => {
  it.each(LOCALES)('%s.json: every plural has an `other` clause', (locale) => {
    const offenders: string[] = [];
    for (const [key, message] of MESSAGES[locale]) {
      for (const node of scanIcu(message).plurals) {
        if (!node.selectors.has('other')) offenders.push(`${key} ({${node.arg}})`);
      }
    }
    expect(offenders, `Missing \`other\` clause (ICU throws MISSING_OTHER_CLAUSE): ${offenders.join(', ')}`).toEqual([]);
  });

  it.each(LOCALES)('%s.json: every plural covers the locale\'s required categories', (locale) => {
    const required = requiredPluralCategories(locale);
    const offenders: string[] = [];
    for (const [key, message] of MESSAGES[locale]) {
      for (const node of scanIcu(message).plurals) {
        if (node.type !== 'plural') continue;
        const categories = new Set([...node.selectors].filter((s) => !s.startsWith('=')));
        const missing = [...required].filter((c) => !categories.has(c));
        if (missing.length > 0) offenders.push(`${key} ({${node.arg}}) missing: ${missing.join('/')}`);
      }
    }
    expect(offenders, `Incomplete plural categories in ${locale}.json: ${offenders.join('; ')}`).toEqual([]);
  });
});

describe('i18n messages: interpolation-argument parity', () => {
  it.each(TARGET_LOCALES)('%s.json uses the same named arguments as en.json', (locale) => {
    const offenders: string[] = [];
    for (const [key, sourceMessage] of MESSAGES[SOURCE_LOCALE]) {
      const target = MESSAGES[locale].get(key);
      if (target === undefined) continue; // key-set parity covers this
      const expected = [...scanIcu(sourceMessage).args].sort();
      const actual = [...scanIcu(target).args].sort();
      if (expected.join(',') !== actual.join(',')) {
        offenders.push(`${key}: en={${expected.join(',')}} ${locale}={${actual.join(',')}}`);
      }
    }
    expect(offenders, `Argument drift in ${locale}.json: ${offenders.join('; ')}`).toEqual([]);
  });

  it('tolerates a key that is a plural in one locale and a plain string in another', () => {
    // ru pluralises library.mobile_count_line; en does not. Both use {sources} and {photos}.
    const en = MESSAGES.en.get('library.mobile_count_line');
    const ru = MESSAGES.ru.get('library.mobile_count_line');
    expect(en).toBeDefined();
    expect(ru).toBeDefined();
    expect([...scanIcu(en!).args].sort()).toEqual(['photos', 'sources']);
    expect([...scanIcu(ru!).args].sort()).toEqual(['photos', 'sources']);
    expect(scanIcu(en!).plurals).toHaveLength(0);
    expect(scanIcu(ru!).plurals).toHaveLength(2);
  });
});
