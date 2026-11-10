import { describe, it, expect, afterEach, vi } from 'vitest';
import { POST as IMPORT_GEDCOM } from '@/app/api/import/gedcom/route';
import { GET as EXPORT_GEDCOM } from '@/app/api/export/gedcom/route';
import { POST as POST_TREE } from '@/app/api/trees/route';
import { POST as POST_PERSON, GET as GET_PEOPLE } from '@/app/api/people/route';
import { POST as POST_FAMILY } from '@/app/api/families/route';
import { POST as POST_REPOSITORY, GET as GET_REPOSITORIES } from '@/app/api/repositories/route';

// Bypass in-memory rate limiter so tests don't exhaust the 5-per-15-min limit
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(() => ({ success: true, remaining: 99 })),
}));
import { NextRequest } from 'next/server';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { query } from '@/lib/db/connection';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { getDataDir } from '@/lib/data-dir';
import type { Tree } from '@/lib/db/schema';

const describeIf = hasTestDatabase() ? describe : describe.skip;

const GEDCOM_SIMPLE = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Imported /Person/
1 SEX M
0 TRLR`;

// A source pointing at a repository record — used to prove a same-named
// repository in a SIBLING tree no longer collides (pre-v20: unique per owner
// → 23505 → whole import rolled back with 409).
const GEDCOM_WITH_REPO = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Archie /Vist/
1 SEX M
0 @S1@ SOUR
1 TITL Census 1900
1 REPO @R1@
0 @R1@ REPO
1 NAME National Archives
0 TRLR`;

function importRequest(gedcom: string, treeId: number, mode = 'overwrite') {
    const formData = new FormData();
    formData.append('file', new File([gedcom], 'test.ged', { type: 'text/plain' }));
    return new NextRequest(`http://localhost:3000/api/import/gedcom?mode=${mode}&treeId=${treeId}`, {
        method: 'POST',
        body: formData,
    });
}

async function createTree(name: string): Promise<Tree> {
    const res = await POST_TREE(
        createRequest('http://localhost:3000/api/trees', { method: 'POST', body: { name } })
    );
    expect(res.status).toBe(201);
    const { tree } = await parseResponse<{ tree: Tree }>(res);
    return tree;
}

describeIf('GEDCOM import/export cross-tree scope', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    it('overwrite import into tree A leaves tree B rows AND disk files untouched', async () => {
        const A = await createTree('Import Target A');
        const B = await createTree('Bystander B');

        // Seed tree B: a person, a family, a source, and a media row with a real
        // file on disk — the exact data an overwrite of tree A must never touch.
        const personBRes = await POST_PERSON(
            createRequest(`http://localhost:3000/api/people?treeId=${B.Id}`, {
                method: 'POST',
                body: { FirstName: 'Bystander', LastName: 'Beta' },
            })
        );
        expect(personBRes.status).toBe(201);
        const { person: personB } = await parseResponse<{ person: { Id: number } }>(personBRes);

        const familyBRes = await POST_FAMILY(
            createRequest(`http://localhost:3000/api/families?treeId=${B.Id}`, {
                method: 'POST',
                body: { Type: 'Marriage' },
            })
        );
        expect(familyBRes.status).toBe(201);

        await query(
            `INSERT INTO "Sources" ("OwnerId", "TreeId", "Title") VALUES ($1, $2, 'Tree B source')`,
            [TEST_USER.id, B.Id]
        );

        const filename = `treeB_survivor_${Date.now()}.jpg`;
        const mediaDir = path.join(getDataDir(), 'uploads', String(TEST_USER.id), 'media');
        const filePath = path.join(mediaDir, filename);
        await mkdir(mediaDir, { recursive: true });
        await writeFile(filePath, Buffer.from('tree-b-image-bytes'));
        await query(
            `INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format") VALUES ($1, $2, 'B photo', $3, 'JPG')`,
            [TEST_USER.id, B.Id, filename]
        );

        try {
            // Overwrite-import into tree A.
            const res = await IMPORT_GEDCOM(importRequest(GEDCOM_SIMPLE, A.Id, 'overwrite'));
            expect(res.status).toBe(200);

            // Tree A holds the imported person.
            const listA = await GET_PEOPLE(createRequest(`http://localhost:3000/api/people?treeId=${A.Id}`));
            const { people: peopleA } = await parseResponse<{ people: { FirstName: string | null }[] }>(listA);
            expect(peopleA.some((p) => p.FirstName === 'Imported')).toBe(true);

            // EVERY tree-B row survives (scoped direct SQL, per test conventions).
            const counts = await query(
                `SELECT
                    (SELECT count(*)::int FROM "People"   WHERE "TreeId" = $1 AND "UserId" = $2)  AS people,
                    (SELECT count(*)::int FROM "Families" WHERE "TreeId" = $1 AND "UserId" = $2)  AS families,
                    (SELECT count(*)::int FROM "Sources"  WHERE "TreeId" = $1 AND "OwnerId" = $2) AS sources,
                    (SELECT count(*)::int FROM "Media"    WHERE "TreeId" = $1 AND "UserId" = $2)  AS media`,
                [B.Id, TEST_USER.id]
            );
            const row = counts.rows[0] as { people: number; families: number; sources: number; media: number };
            expect(row.people).toBe(1);
            expect(row.families).toBe(1);
            expect(row.sources).toBe(1);
            expect(row.media).toBe(1);

            // The specific person row is intact.
            const personRow = await query(
                `SELECT "FirstName" FROM "People" WHERE "Id" = $1 AND "UserId" = $2`,
                [personB.Id, TEST_USER.id]
            );
            expect((personRow.rows[0] as { FirstName: string }).FirstName).toBe('Bystander');

            // Tree B's disk file survives — overwrite's orphan cleanup reads
            // FilePaths of the TARGET tree only.
            expect(existsSync(filePath)).toBe(true);
        } finally {
            await unlink(filePath).catch(() => undefined);
        }
    });

    it('a repository name existing in a sibling tree does not block the import (per-tree unique)', async () => {
        const A = await createTree('Repo Tree A');
        const B = await createTree('Repo Tree B');

        // Tree A already has "National Archives".
        const repoARes = await POST_REPOSITORY(
            createRequest(`http://localhost:3000/api/repositories?treeId=${A.Id}`, {
                method: 'POST',
                body: { Name: 'National Archives' },
            })
        );
        expect(repoARes.status).toBe(201);

        // Import a GEDCOM whose REPO has the same name into tree B — pre-v20 the
        // owner-level unique constraint aborted the entire import with 409.
        const res = await IMPORT_GEDCOM(importRequest(GEDCOM_WITH_REPO, B.Id, 'merge'));
        expect(res.status).toBe(200);

        // Two independent rows, one per tree.
        const listA = await GET_REPOSITORIES(createRequest(`http://localhost:3000/api/repositories?treeId=${A.Id}`));
        const { repositories: reposA } = await parseResponse<{ repositories: { Name: string }[] }>(listA);
        const listB = await GET_REPOSITORIES(createRequest(`http://localhost:3000/api/repositories?treeId=${B.Id}`));
        const { repositories: reposB } = await parseResponse<{ repositories: { Name: string }[] }>(listB);
        expect(reposA.filter((r) => r.Name === 'National Archives')).toHaveLength(1);
        expect(reposB.filter((r) => r.Name === 'National Archives')).toHaveLength(1);

        const rows = await query(
            `SELECT "TreeId" FROM "Repository" WHERE "OwnerId" = $1 AND "Name" = 'National Archives' ORDER BY "TreeId"`,
            [TEST_USER.id]
        );
        expect(rows.rows.map((r) => (r as { TreeId: number }).TreeId).sort((a, b) => a - b))
            .toEqual([A.Id, B.Id].sort((a, b) => a - b));
    });

    it('export of tree A contains only tree A people (no cross-tree leak)', async () => {
        const A = await createTree('Export A');
        const B = await createTree('Export B');

        for (const [treeId, first, last] of [
            [A.Id, 'Alpha', 'Exportee'],
            [B.Id, 'Bravo', 'Hidden'],
        ] as const) {
            const res = await POST_PERSON(
                createRequest(`http://localhost:3000/api/people?treeId=${treeId}`, {
                    method: 'POST',
                    body: { FirstName: first, LastName: last },
                })
            );
            expect(res.status).toBe(201);
        }

        const res = await EXPORT_GEDCOM(
            new NextRequest(`http://localhost:3000/api/export/gedcom?treeId=${A.Id}`)
        );
        expect(res.status).toBe(200);
        const gedcom = await res.text();
        expect(gedcom).toContain('Alpha');
        expect(gedcom).not.toContain('Bravo');
        expect(gedcom).not.toContain('Hidden');
    });

    it('denies hosted export of a foreign unshared tree before media preflight', async () => {
        const foreignTreeId = await resolveDefaultTree(TEST_USER_2.id);
        const res = await EXPORT_GEDCOM(
            new NextRequest(`http://localhost:3000/api/export/gedcom?treeId=${foreignTreeId}&preflight=true&includeMedia=true`),
        );
        expect(res.status).toBe(403);
    });
});
