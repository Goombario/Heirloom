import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMonthWord } from '@/lib/date-utils';
import { parseAliasList } from '@/app/components/date-input/aliases';

/**
 * The alias lists are translator-editable strings in messages/*.json. A qualifier
 * alias that also parses as a month name would make "mar 1850" ambiguous — is it
 * March, or an alias hoisted to a qualifier? Nothing else in the pipeline would
 * notice, so this guards it in CI rather than in review.
 */
const LOCALES = ['en', 'fr', 'ru'] as const;
const ALIAS_KEYS = ['alias_abt', 'alias_bef', 'alias_aft'] as const;

describe('qualifier aliases do not collide with month names', () => {
  it.each(LOCALES)('%s', (locale) => {
    const raw = readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8');
    const messages = JSON.parse(raw) as { dateInput: Record<string, string> };
    for (const key of ALIAS_KEYS) {
      const value = messages.dateInput[key];
      expect(value, `${locale}.json is missing dateInput.${key}`).toBeTypeOf('string');
      for (const alias of parseAliasList(value)) {
        expect(isMonthWord(alias), `dateInput.${key} in ${locale}.json contains "${alias}", which is also a month name`).toBe(false);
      }
    }
  });
});
