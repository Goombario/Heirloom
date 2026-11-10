import { describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db/connection', () => ({ query }));

import { getPeopleForExport } from '@/lib/db/queries/gedcom-export';

describe('GEDCOM export query ordering', () => {
  it('uses Id as a deterministic tie-breaker for equal names', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await getPeopleForExport(7);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY p."LastName", p."FirstName", p."Id"'),
      [7],
    );
  });
});
