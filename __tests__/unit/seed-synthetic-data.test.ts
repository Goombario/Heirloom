import { describe, expect, it } from 'vitest';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { assertEmptyTree, commitHostedSeed } from '@/scripts/seed-synthetic-data';

describe('hosted synthetic seed preflight', () => {
  it('locks the target tree before checking whether it is empty', async () => {
    const statements: string[] = [];
    const client = {
      query: async (text: string) => {
        statements.push(text);
        return statements.length === 1
          ? { rows: [{ OwnerId: 7 }] }
          : { rows: [{ rowCount: '0' }] };
      },
    };

    await assertEmptyTree(client, 42, 7);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/SELECT "OwnerId" FROM "Trees" WHERE "Id" = \$1 FOR UPDATE/);
    expect(statements[1]).toContain('FROM "People" WHERE "TreeId" = $1');
  });

  it('preserves hosted files when the surrounding commit outcome is ambiguous', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'synthetic-seed-commit-'));
    const file = path.join(directory, 'synthetic-media.png');
    await writeFile(file, 'synthetic');
    const statements: string[] = [];
    const client = {
      query: async (text: string) => {
        statements.push(text);
        if (text === 'COMMIT') throw new Error('synthetic commit failure');
        return { rows: [] };
      },
    };

    try {
      await expect(commitHostedSeed(client, async (registerFiles) => {
        registerFiles([file]);
        return { treeId: 42 };
      })).rejects.toThrow('synthetic commit failure');
      await expect(access(file)).resolves.toBeUndefined();
      expect(statements).toEqual(['COMMIT', 'ROLLBACK']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('removes hosted files when seeding fails before commit and rollback succeeds', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'synthetic-seed-rollback-'));
    const file = path.join(directory, 'synthetic-media.png');
    await writeFile(file, 'synthetic');
    const statements: string[] = [];
    const client = {
      query: async (text: string) => {
        statements.push(text);
        return { rows: [] };
      },
    };

    try {
      await expect(commitHostedSeed(client, async (registerFiles) => {
        registerFiles([file]);
        throw new Error('synthetic seed failure');
      })).rejects.toThrow('synthetic seed failure');
      await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(statements).toEqual(['ROLLBACK']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
