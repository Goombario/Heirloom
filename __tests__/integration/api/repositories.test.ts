import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as LIST_REPOS, POST as CREATE_REPO } from '@/app/api/repositories/route';
import { GET as GET_REPO, PUT as UPDATE_REPO, DELETE as DELETE_REPO } from '@/app/api/repositories/[id]/route';
import { GET as REPO_SOURCES } from '@/app/api/repositories/[id]/sources/route';
import { POST as CREATE_SOURCE, GET as LIST_SOURCES } from '@/app/api/sources/route';
import { PUT as UPDATE_SOURCE } from '@/app/api/sources/[id]/route';
import { POST as POST_SHARING } from '@/app/api/sharing/route';
import { query } from '@/lib/db/connection';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface RepoShape { Id: number; Name: string; Address: string | null; SourceCount?: number }
interface SourceShape { Id: number; Title: string | null; RepositoryName: string | null; RepositoryId: number | null }

describeIf('API /api/repositories', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    async function createSourceWithRepo(title: string, repositoryName: string | null): Promise<SourceShape> {
        const res = await CREATE_SOURCE(createRequest('http://localhost:3000/api/sources', {
            method: 'POST', body: { Title: title, Type: 'Document', RepositoryName: repositoryName },
        }));
        return (await parseResponse<{ source: SourceShape }>(res)).source;
    }

    async function listRepos(): Promise<RepoShape[]> {
        const res = await LIST_REPOS(createRequest('http://localhost:3000/api/repositories'));
        return (await parseResponse<{ repositories: RepoShape[] }>(res)).repositories;
    }

    it('auto-creates and links a Repository when a source names one, and lists it with a count', async () => {
        await createSourceWithRepo('Census 1881', 'State Archive of Moscow');
        await createSourceWithRepo('Parish register', 'State Archive of Moscow');
        await createSourceWithRepo('Family Bible', 'Home');

        const repos = await listRepos();
        const archive = repos.find(r => r.Name === 'State Archive of Moscow');
        expect(archive).toBeTruthy();
        expect(archive!.SourceCount).toBe(2);
        expect(repos.find(r => r.Name === 'Home')!.SourceCount).toBe(1);
    });

    it('keeps one Repository per (TreeId, Name) — the per-tree unique index rejects a duplicate insert', async () => {
        await createSourceWithRepo('Census 1881', 'Regional Archive');
        await createSourceWithRepo('Parish register', 'Regional Archive');

        // findOrCreateRepository upserts, so both sources share the single row.
        const rows = await query(
            `SELECT "Id", "TreeId" FROM "Repository" WHERE "OwnerId" = $1 AND "Name" = $2`,
            [TEST_USER.id, 'Regional Archive'],
        );
        expect(rows.rowCount).toBe(1);
        const treeId = (rows.rows[0] as { TreeId: number }).TreeId;

        // The index (not just the app logic) forbids a second row IN THE SAME TREE.
        await expect(
            query(`INSERT INTO "Repository" ("OwnerId", "TreeId", "Name") VALUES ($1, $2, $3)`,
                [TEST_USER.id, treeId, 'Regional Archive']),
        ).rejects.toThrow();
    });

    it('lists the sources held by a repository', async () => {
        const src = await createSourceWithRepo('Census 1881', 'State Archive');
        const repoId = (await listRepos()).find(r => r.Name === 'State Archive')!.Id;

        const res = await REPO_SOURCES(
            createRequest(`http://localhost:3000/api/repositories/${repoId}/sources`),
            { params: Promise.resolve({ id: String(repoId) }) },
        );
        const { sources } = await parseResponse<{ sources: { Id: number; Title: string | null }[] }>(res);
        expect(sources.map(s => s.Id)).toContain(src.Id);
    });

    it('creates a repository directly via POST (no source needed) and lists it', async () => {
        const res = await CREATE_REPO(createRequest('http://localhost:3000/api/repositories', {
            method: 'POST', body: { Name: 'British Library', Address: 'London, UK' },
        }));
        expect(res.status).toBe(201);
        const { repository } = await parseResponse<{ repository: RepoShape }>(res);
        expect(repository.Name).toBe('British Library');
        expect(repository.Address).toBe('London, UK');

        const repos = await listRepos();
        const created = repos.find(r => r.Name === 'British Library');
        expect(created).toBeTruthy();
        expect(created!.SourceCount).toBe(0);
    });

    it('rejects creating a repository with a duplicate name (400)', async () => {
        await CREATE_REPO(createRequest('http://localhost:3000/api/repositories', {
            method: 'POST', body: { Name: 'Duplicate Archive' },
        }));
        const res = await CREATE_REPO(createRequest('http://localhost:3000/api/repositories', {
            method: 'POST', body: { Name: 'Duplicate Archive' },
        }));
        expect(res.status).toBe(400);
    });

    it('rejects creating a repository with an empty name (400)', async () => {
        const res = await CREATE_REPO(createRequest('http://localhost:3000/api/repositories', {
            method: 'POST', body: { Name: '' },
        }));
        expect(res.status).toBe(400);
    });

    it('view-only collaborator gets 403 creating a repository', async () => {
        await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
            method: 'POST', body: { email: TEST_USER_2.email, permission: 'view' },
        }));
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
        const res = await CREATE_REPO(createRequest(`http://localhost:3000/api/repositories?ownerId=${TEST_USER.id}`, {
            method: 'POST', body: { Name: 'Sneaky Archive' },
        }));
        expect(res.status).toBe(403);
    });

    it('renames a repository and dual-writes the source RepositoryName', async () => {
        const src = await createSourceWithRepo('Census 1881', 'Old Name');
        const repoId = (await listRepos()).find(r => r.Name === 'Old Name')!.Id;

        const res = await UPDATE_REPO(
            createRequest(`http://localhost:3000/api/repositories/${repoId}`, {
                method: 'PUT', body: { Name: 'New Name', Address: 'Tula, Russia' },
            }),
            { params: Promise.resolve({ id: String(repoId) }) },
        );
        expect(res.status).toBe(200);
        const { repository } = await parseResponse<{ repository: RepoShape }>(res);
        expect(repository.Name).toBe('New Name');
        expect(repository.Address).toBe('Tula, Russia');

        // The legacy text column on the linked source should follow the rename.
        const srcRes = await LIST_SOURCES(createRequest('http://localhost:3000/api/sources'));
        const { sources } = await parseResponse<{ sources: SourceShape[] }>(srcRes);
        expect(sources.find(s => s.Id === src.Id)!.RepositoryName).toBe('New Name');
    });

    it('rejects an empty repository name with 400', async () => {
        await createSourceWithRepo('Census 1881', 'Some Archive');
        const repoId = (await listRepos()).find(r => r.Name === 'Some Archive')!.Id;
        const res = await UPDATE_REPO(
            createRequest(`http://localhost:3000/api/repositories/${repoId}`, { method: 'PUT', body: { Name: '' } }),
            { params: Promise.resolve({ id: String(repoId) }) },
        );
        expect(res.status).toBe(400);
    });

    it('deletes a repository and detaches its sources', async () => {
        const src = await createSourceWithRepo('Census 1881', 'Doomed Archive');
        const repoId = (await listRepos()).find(r => r.Name === 'Doomed Archive')!.Id;

        const delRes = await DELETE_REPO(
            createRequest(`http://localhost:3000/api/repositories/${repoId}`, { method: 'DELETE' }),
            { params: Promise.resolve({ id: String(repoId) }) },
        );
        expect(delRes.status).toBe(204);

        expect((await listRepos()).find(r => r.Id === repoId)).toBeUndefined();

        // The source survives but is detached (both the link and the legacy text cleared).
        const srcRes = await LIST_SOURCES(createRequest('http://localhost:3000/api/sources'));
        const { sources } = await parseResponse<{ sources: SourceShape[] }>(srcRes);
        const survivor = sources.find(s => s.Id === src.Id);
        expect(survivor).toBeTruthy();
        expect(survivor!.RepositoryName).toBeNull();
        expect(survivor!.RepositoryId).toBeNull();
    });

    it('re-syncs the link when a source changes its repository name', async () => {
        const src = await createSourceWithRepo('Census 1881', 'First Archive');
        await UPDATE_SOURCE(
            createRequest(`http://localhost:3000/api/sources/${src.Id}`, {
                method: 'PUT', body: { RepositoryName: 'Second Archive' },
            }),
            { params: Promise.resolve({ id: String(src.Id) }) },
        );

        const repos = await listRepos();
        expect(repos.find(r => r.Name === 'Second Archive')!.SourceCount).toBe(1);
        // The old repository now holds nothing.
        const first = repos.find(r => r.Name === 'First Archive');
        if (first) expect(first.SourceCount).toBe(0);
    });

    it('returns 404 for a non-existent repository', async () => {
        const res = await GET_REPO(
            createRequest('http://localhost:3000/api/repositories/999999'),
            { params: Promise.resolve({ id: '999999' }) },
        );
        expect(res.status).toBe(404);
    });

    it('view-only collaborator gets 403 updating a repository', async () => {
        await createSourceWithRepo('Census 1881', 'Shared Archive');
        const repoId = (await listRepos()).find(r => r.Name === 'Shared Archive')!.Id;
        await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
            method: 'POST', body: { email: TEST_USER_2.email, permission: 'view' },
        }));
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
        const res = await UPDATE_REPO(
            createRequest(`http://localhost:3000/api/repositories/${repoId}?ownerId=${TEST_USER.id}`, {
                method: 'PUT', body: { Name: 'Hijacked' },
            }),
            { params: Promise.resolve({ id: String(repoId) }) },
        );
        expect(res.status).toBe(403);
    });

    it('returns 401 when unauthenticated', async () => {
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
        const res = await DELETE_REPO(
            createRequest('http://localhost:3000/api/repositories/1', { method: 'DELETE' }),
            { params: Promise.resolve({ id: '1' }) },
        );
        expect(res.status).toBe(401);
    });
});
