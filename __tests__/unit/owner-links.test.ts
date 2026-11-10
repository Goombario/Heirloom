import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validatedOwner, assertOwnerInTree } from '@/lib/services/owner-links';
import { isMediaOwnerTable } from '@/lib/db/fact-tables';
import { ownerExistsInTree } from '@/lib/db/queries/owner-links';
import { ValidationError } from '@/lib/validation';
import { NotFoundError } from '@/lib/data/errors';

// owner-links is security-relevant (IDOR guard + ownerTable allowlisting) but was
// the only untested service. validatedOwner is pure; assertOwnerInTree only needs
// a stubbed `query` — no database.
const query = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/connection', () => ({ query }));

describe('validatedOwner', () => {
  it('accepts every allowlisted link-owner table and echoes it back', () => {
    for (const table of ['People', 'Families', 'Events', 'Sources', 'Places'] as const) {
      expect(validatedOwner(table, 1)).toBe(table);
    }
  });

  it('rejects an unknown / injection-y ownerTable with a ValidationError', () => {
    expect(() => validatedOwner('Users', 1)).toThrow(ValidationError);
    expect(() => validatedOwner('People"); DROP TABLE', 1)).toThrow(ValidationError);
    expect(() => validatedOwner('', 1)).toThrow(ValidationError);
  });

  it('rejects a non-positive / non-finite ownerId', () => {
    expect(() => validatedOwner('People', 0)).toThrow(ValidationError);
    expect(() => validatedOwner('People', -5)).toThrow(ValidationError);
    expect(() => validatedOwner('People', NaN)).toThrow(ValidationError);
    expect(() => validatedOwner('People', Infinity)).toThrow(ValidationError);
  });
});

describe('media owner vocabulary', () => {
  it('allows only record tables that media can attach to', () => {
    expect(isMediaOwnerTable('People')).toBe(true);
    expect(isMediaOwnerTable('Families')).toBe(true);
    expect(isMediaOwnerTable('Events')).toBe(true);
    expect(isMediaOwnerTable('Sources')).toBe(true);
    expect(isMediaOwnerTable('Places')).toBe(false);
    expect(isMediaOwnerTable('Repository')).toBe(false);
  });
});

describe('ownerExistsInTree', () => {
  beforeEach(() => query.mockReset());

  it('uses a tree-scoped predicate for a media owner', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });

    await expect(ownerExistsInTree('Events', 7, 42)).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      'SELECT 1 FROM "Events" WHERE "Id" = $1 AND "TreeId" = $2',
      [7, 42],
    );
  });

  it('returns false when the media owner is missing or belongs to another tree', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(ownerExistsInTree('Sources', 7, 42)).resolves.toBe(false);
  });
});

describe('assertOwnerInTree', () => {
  beforeEach(() => query.mockReset());

  it('resolves when the owner row is found in the tree', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
    await expect(assertOwnerInTree('People', 7, 42)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.any(String), [7, 42]);
  });

  it('throws NotFoundError when the owner row is not in the tree', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(assertOwnerInTree('Families', 7, 42)).rejects.toThrow(NotFoundError);
  });

  it('scopes every table uniformly by "TreeId" (multi-tree)', async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ '?column?': 1 }] });

    await assertOwnerInTree('Sources', 3, 99);
    expect(query.mock.calls[0][0]).toContain('"Sources"');
    expect(query.mock.calls[0][0]).toContain('"TreeId"');

    await assertOwnerInTree('Events', 3, 99);
    expect(query.mock.calls[1][0]).toContain('"Events"');
    expect(query.mock.calls[1][0]).toContain('"TreeId"');
  });
});
