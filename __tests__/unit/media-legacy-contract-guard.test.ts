import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RUNTIME_FILES = [
  'lib/db/schema.ts',
  'lib/data/types.ts',
  'lib/db/queries/audit.ts',
  'lib/db/queries/cases.ts',
  'lib/db/queries/media.ts',
  'lib/db/queries/media-links.ts',
  'lib/db/queries/media-tags.ts',
  'lib/services/media.ts',
  'lib/services/gedcom.ts',
  'scripts/audit-media-links.ts',
] as const;

const FORBIDDEN_RUNTIME_DEPENDENCIES = [
  /synchronizeMediaCompatibility/,
  /legacySource\s*[?:]/,
  /['"]Media\.PersonId['"]/,
  /['"]Media\.IsPrimary['"]/,
  /['"]MediaTag\.IsPrimary['"]/,
  /\bm\."PersonId"/,
  /\bm\."IsPrimary"/,
  /\b(?:t|mt)\."IsPrimary"/,
  /\bmedia_PersonId\b/,
] as const;

function sourceFor(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('legacy media storage contract guard', () => {
  it('has no runtime dependency on the three dropped compatibility columns', () => {
    const violations = RUNTIME_FILES.flatMap((path) => {
      const source = sourceFor(path);
      return FORBIDDEN_RUNTIME_DEPENDENCIES
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${path}: ${pattern.source}`);
    });

    expect(violations).toEqual([]);
  });

  it('removes the compatibility fields from the Media and MediaTag row types', () => {
    const schema = sourceFor('lib/db/schema.ts');
    const media = schema.match(/export interface Media \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const mediaTag = schema.match(/export interface MediaTag \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(media).not.toMatch(/^\s*(PersonId|IsPrimary)\??:/m);
    expect(mediaTag).not.toMatch(/^\s*IsPrimary\??:/m);
  });
});
