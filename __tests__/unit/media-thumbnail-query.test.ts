import { describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/connection', () => ({ query }));

import { listHostedMediaForThumbnailBackfill } from '@/lib/db/queries/media';

describe('hosted thumbnail backfill query', () => {
  it('selects only raster image media and keeps the stable cursor contract', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(listHostedMediaForThumbnailBackfill(41, 100)).resolves.toEqual([]);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE\s+"FilePath"\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/"ContentType"\s+LIKE\s+'image\/%'/i);
    expect(sql).toMatch(/"ContentType"\s+NOT\s+IN\s+\('image\/svg\+xml',\s*'image\/gif'\)/i);
    expect(sql).toMatch(/"Id"\s*>\s*\$1/i);
    expect(sql).toMatch(/ORDER BY\s+"Id"\s+ASC/i);
    expect(sql).toMatch(/LIMIT\s+\$2/i);
    expect(params).toEqual([41, 100]);
  });
});
