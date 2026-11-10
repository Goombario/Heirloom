import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CLAUDE.md states the invariant: `ENTITY_CONFIG` in `audit.ts` must stay in sync
 * with the `ALLOWED_*_FIELDS` sets in the query files. Nothing enforced it, and it
 * drifted — `DeathCause` (#480) was added to `ALLOWED_PERSON_FIELDS` alone, which
 * silently makes that field unrevertable from the audit log: `revertAuditEntry`
 * filters the diff through `ENTITY_CONFIG`, and `revertAuditEntries`' delete-revert
 * re-inserts only the fields listed there, so a restored person would come back
 * without their cause of death.
 *
 * Both sets are module-private, so this reads the literals out of the source rather
 * than importing them — the alternative is exporting internals purely for a test
 * (which knip would then flag). Deliberately narrow: it asserts set equality for the
 * pairs that exist, and fails loudly if either literal stops being findable, rather
 * than silently passing on a refactor that renames them.
 */

const root = join(__dirname, '..', '..');

function setLiteral(source: string, marker: RegExp, label: string): Set<string> {
  const match = source.match(marker);
  if (!match) throw new Error(`could not locate the ${label} set literal — update this test`);
  const names = match[1].match(/'([^']+)'/g) ?? [];
  return new Set(names.map(n => n.slice(1, -1)));
}

const audit = readFileSync(join(root, 'lib', 'db', 'queries', 'audit.ts'), 'utf8');

const pairs: Array<{ entity: string; file: string; constName: string }> = [
  { entity: 'person', file: 'people.ts', constName: 'ALLOWED_PERSON_FIELDS' },
  { entity: 'family', file: 'families.ts', constName: 'ALLOWED_FAMILY_FIELDS' },
  { entity: 'event', file: 'events.ts', constName: 'ALLOWED_EVENT_FIELDS' },
];

describe('audit ENTITY_CONFIG matches the query-layer field allowlists', () => {
  for (const { entity, file, constName } of pairs) {
    it(`${entity}: ENTITY_CONFIG.${entity}.allowedFields === ${constName}`, () => {
      const queryFile = readFileSync(join(root, 'lib', 'db', 'queries', file), 'utf8');
      const fromQueries = setLiteral(
        queryFile,
        new RegExp(`${constName}[^=]*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`),
        constName,
      );
      const fromAudit = setLiteral(
        audit,
        new RegExp(`${entity}:\\s*\\{[\\s\\S]*?allowedFields:\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`),
        `ENTITY_CONFIG.${entity}.allowedFields`,
      );
      expect([...fromAudit].sort()).toEqual([...fromQueries].sort());
    });
  }
});
