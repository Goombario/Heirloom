import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSyntheticCli } from '@/scripts/seed-synthetic-data';
import { logicalToDatadir, validateDump } from '@/lib/db/connection.pglite';

describe('synthetic .hlbak artifact', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('generates and verifies a browser-loadable fixture', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'synthetic-fixture-test-'));
    const output = path.join(directory, 'synthetic.hlbak');
    await runSyntheticCli(['static', '--output', output]);
    await runSyntheticCli(['verify', '--input', output]);

    const bytes = await readFile(output);
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('HLBK\x02');
    await validateDump(await logicalToDatadir(new Blob([bytes])));
    const manifest = JSON.parse(await readFile(`${output.replace(/\.hlbak$/i, '')}.manifest.json`, 'utf8')) as { counts: { people: number; media: number; tags: number; faceCandidates: number; sources: number; citations: number } };
    expect(manifest.counts).toMatchObject({ people: 120, media: 30, tags: 120, faceCandidates: 6, sources: 7 });
    expect(manifest.counts.citations).toBeGreaterThan(50);
  }, 30_000);
});
