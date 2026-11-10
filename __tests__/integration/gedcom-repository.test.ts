import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';
import { getRepositories, getSourcesForRepository } from '@/lib/db/queries/repositories';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// Dedicated, otherwise-unused user id — integration tests run in parallel.
const REPO_USER = 987658;

function gedFile(text: string): File {
  return new File([text], 'family_tree.ged', { type: 'text/plain' });
}

d('Repository as an entity (Slice 4)', () => {
  // Multi-tree: the import resolves this user's default tree (Trees FK's Users,
  // so the synthetic id needs a real Users row) and stamps TreeId on every row;
  // the tree-scoped readers below take that treeId.
  let treeId: number;

  beforeAll(async () => {
    await query(
      'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3) ON CONFLICT ("Id") DO NOTHING',
      [REPO_USER, `gedcom-repository-${REPO_USER}@test.local`, `google-${REPO_USER}`],
    );
    treeId = await resolveDefaultTree(REPO_USER);
  });

  afterEach(async () => {
    await query('DELETE FROM "Sources" WHERE "OwnerId" = $1', [REPO_USER]);
    await query('DELETE FROM "Repository" WHERE "OwnerId" = $1', [REPO_USER]);
  });

  it('imports a REPO record + CALN.MEDI as a Repository entity linked from the source', async () => {
    const ged = [
      '0 HEAD',
      '0 @S1@ SOUR', '1 TITL Parish register', '1 REPO @R1@', '2 CALN MS 12/3', '3 MEDI Microfilm',
      '0 @S2@ SOUR', '1 TITL Banns', '1 REPO @R1@',
      '0 @R1@ REPO', '1 NAME Diocesan Archive', '1 ADDR 1 Cathedral Close',
      '0 TRLR',
    ].join('\n');
    await importGedcomService({ file: gedFile(ged), mode: 'overwrite', currentUserId: REPO_USER });

    const repos = await getRepositories(treeId);
    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({ Name: 'Diocesan Archive', Address: '1 Cathedral Close' });

    // Both sources link to the single archive (one repo → many sources).
    const sources = await getSourcesForRepository(repos[0].Id, treeId);
    expect(sources.map((s) => s.Title).sort()).toEqual(['Banns', 'Parish register']);

    // CALN.MEDI persisted on the source.
    const medi = await query(
      `SELECT "RepositoryMedi" FROM "Sources" WHERE "OwnerId" = $1 AND "Title" = 'Parish register'`,
      [REPO_USER]
    );
    expect((medi.rows[0] as { RepositoryMedi: string | null }).RepositoryMedi).toBe('Microfilm');
  });

  it('overwrite import clears prior repositories (no stale accumulation)', async () => {
    const ged1 = ['0 HEAD', '0 @S1@ SOUR', '1 TITL A', '1 REPO @R1@', '0 @R1@ REPO', '1 NAME Old Archive', '0 TRLR'].join('\n');
    await importGedcomService({ file: gedFile(ged1), mode: 'overwrite', currentUserId: REPO_USER });
    const ged2 = ['0 HEAD', '0 @S1@ SOUR', '1 TITL B', '1 REPO @R1@', '0 @R1@ REPO', '1 NAME New Archive', '0 TRLR'].join('\n');
    await importGedcomService({ file: gedFile(ged2), mode: 'overwrite', currentUserId: REPO_USER });

    const repos = await getRepositories(treeId);
    expect(repos.map((r) => r.Name)).toEqual(['New Archive']);
  });
});
