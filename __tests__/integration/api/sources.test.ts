import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as LIST_SOURCES, POST as CREATE_SOURCE } from '@/app/api/sources/route';
import { GET as GET_SOURCE, PUT as UPDATE_SOURCE, DELETE as DELETE_SOURCE } from '@/app/api/sources/[id]/route';
import { POST as POST_SHARING } from '@/app/api/sharing/route';
import { query } from '@/lib/db/connection';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface SourceShape {
    Id: number;
    OwnerId: number | null;
    Title: string | null;
    Type: string | null;
}

describeIf('API /api/sources', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    async function createSourceAsOwner(title = 'Census 1881', extra: Record<string, unknown> = {}) {
        const res = await CREATE_SOURCE(createRequest('http://localhost:3000/api/sources', {
            method: 'POST',
            body: { Title: title, Type: 'Census', ...extra },
        }));
        const data = await parseResponse<{ source: SourceShape }>(res);
        return data.source;
    }

    async function shareWithUser2(permission: 'edit' | 'contribute' | 'view') {
        await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
            method: 'POST',
            body: { email: TEST_USER_2.email, permission },
        }));
    }

    describe('owner CRUD', () => {
        it('creates a source under the owner', async () => {
            const res = await CREATE_SOURCE(createRequest('http://localhost:3000/api/sources', {
                method: 'POST',
                body: { Title: 'Birth Register', Type: 'Vital' },
            }));
            expect(res.status).toBe(201);
            const { source } = await parseResponse<{ source: SourceShape }>(res);
            expect(source.Title).toBe('Birth Register');
            expect(source.OwnerId).toBe(TEST_USER.id);
        });

        it('rejects a source with no title', async () => {
            const res = await CREATE_SOURCE(createRequest('http://localhost:3000/api/sources', {
                method: 'POST',
                body: { Type: 'Document' },
            }));
            expect(res.status).toBe(400);
        });

        it('rejects an unknown Type with 400 on both create and update (#712)', async () => {
            const createRes = await CREATE_SOURCE(createRequest('http://localhost:3000/api/sources', {
                method: 'POST',
                body: { Title: 'x', Type: 'church_record' },
            }));
            expect(createRes.status).toBe(400);

            const source = await createSourceAsOwner();
            const putRes = await UPDATE_SOURCE(
                createRequest(`http://localhost:3000/api/sources/${source.Id}`, {
                    method: 'PUT',
                    body: { Type: 'Marriage bond' },
                }),
                { params: Promise.resolve({ id: String(source.Id) }) }
            );
            expect(putRes.status).toBe(400);
        });

        it('keeps a source with an imported unknown Type editable (#712)', async () => {
            // GEDCOM import stores a foreign `_TYPE` verbatim.
            const source = await createSourceAsOwner();
            await query(`UPDATE "Sources" SET "Type" = $1 WHERE "Id" = $2`, ['church_record', source.Id]);
            const put = (body: Record<string, unknown>) => UPDATE_SOURCE(
                createRequest(`http://localhost:3000/api/sources/${source.Id}`, { method: 'PUT', body }),
                { params: Promise.resolve({ id: String(source.Id) }) }
            );

            const same = await put({ Title: 'Renamed', Type: 'church_record' });
            const { source: updated } = await parseResponse<{ source: SourceShape }>(same);
            expect(updated.Title).toBe('Renamed');
            expect(updated.Type).toBe('church_record');

            expect((await put({ Type: 'Marriage bond' })).status).toBe(400);
            const known = await parseResponse<{ source: SourceShape }>(await put({ Type: 'Church' }));
            expect(known.source.Type).toBe('Church');
        });

        it('reads, updates and deletes its own source', async () => {
            const source = await createSourceAsOwner();

            const getRes = await GET_SOURCE(
                createRequest(`http://localhost:3000/api/sources/${source.Id}`),
                { params: Promise.resolve({ id: String(source.Id) }) }
            );
            expect(getRes.status).toBe(200);

            const putRes = await UPDATE_SOURCE(
                createRequest(`http://localhost:3000/api/sources/${source.Id}`, {
                    method: 'PUT',
                    body: { Title: 'Census 1891' },
                }),
                { params: Promise.resolve({ id: String(source.Id) }) }
            );
            const { source: updated } = await parseResponse<{ source: SourceShape }>(putRes);
            expect(updated.Title).toBe('Census 1891');

            const delRes = await DELETE_SOURCE(
                createRequest(`http://localhost:3000/api/sources/${source.Id}`, { method: 'DELETE' }),
                { params: Promise.resolve({ id: String(source.Id) }) }
            );
            expect(delRes.status).toBe(204);

            const getAgain = await GET_SOURCE(
                createRequest(`http://localhost:3000/api/sources/${source.Id}`),
                { params: Promise.resolve({ id: String(source.Id) }) }
            );
            expect(getAgain.status).toBe(404);
        });

        it('search is scoped to the owner', async () => {
            await createSourceAsOwner('Glasgow Directory');

            const ownerSearch = await LIST_SOURCES(createRequest('http://localhost:3000/api/sources?q=Glasgow'));
            const ownerData = await parseResponse<{ sources: SourceShape[] }>(ownerSearch);
            expect(ownerData.sources).toHaveLength(1);

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const otherSearch = await LIST_SOURCES(createRequest('http://localhost:3000/api/sources?q=Glasgow'));
            const otherData = await parseResponse<{ sources: SourceShape[] }>(otherSearch);
            expect(otherData.sources).toHaveLength(0);
        });
    });

    describe('shared-tree access', () => {
        it('viewer reads owner sources via ownerId', async () => {
            const source = await createSourceAsOwner();
            await shareWithUser2('view');

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const listRes = await LIST_SOURCES(
                createRequest(`http://localhost:3000/api/sources?ownerId=${TEST_USER.id}`)
            );
            expect(listRes.status).toBe(200);
            const { sources } = await parseResponse<{ sources: SourceShape[] }>(listRes);
            expect(sources).toHaveLength(1);

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const getRes = await GET_SOURCE(
                createRequest(`http://localhost:3000/api/sources/${source.Id}?ownerId=${TEST_USER.id}`),
                { params: Promise.resolve({ id: String(source.Id) }) }
            );
            expect(getRes.status).toBe(200);
        });

        it('contributor creates a source stored under the tree owner', async () => {
            await shareWithUser2('contribute');

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const res = await CREATE_SOURCE(
                createRequest(`http://localhost:3000/api/sources?ownerId=${TEST_USER.id}`, {
                    method: 'POST',
                    body: { Title: 'Parish Record', Type: 'Church' },
                })
            );
            expect(res.status).toBe(201);
            const { source } = await parseResponse<{ source: SourceShape }>(res);
            expect(source.OwnerId).toBe(TEST_USER.id);
        });

        it('contributor can update but cannot delete a shared source', async () => {
            const source = await createSourceAsOwner();
            await shareWithUser2('contribute');

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const putRes = await UPDATE_SOURCE(
                createRequest(`http://localhost:3000/api/sources/${source.Id}?ownerId=${TEST_USER.id}`, {
                    method: 'PUT',
                    body: { Title: 'Edited by contributor' },
                }),
                { params: Promise.resolve({ id: String(source.Id) }) }
            );
            expect(putRes.status).toBe(200);

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const delRes = await DELETE_SOURCE(
                createRequest(`http://localhost:3000/api/sources/${source.Id}?ownerId=${TEST_USER.id}`, { method: 'DELETE' }),
                { params: Promise.resolve({ id: String(source.Id) }) }
            );
            expect(delRes.status).toBe(403);
        });

        it('editor can delete a shared source', async () => {
            const source = await createSourceAsOwner();
            await shareWithUser2('edit');

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const delRes = await DELETE_SOURCE(
                createRequest(`http://localhost:3000/api/sources/${source.Id}?ownerId=${TEST_USER.id}`, { method: 'DELETE' }),
                { params: Promise.resolve({ id: String(source.Id) }) }
            );
            expect(delRes.status).toBe(204);
        });

        it('view-only user gets 403 creating a source', async () => {
            await shareWithUser2('view');

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const res = await CREATE_SOURCE(
                createRequest(`http://localhost:3000/api/sources?ownerId=${TEST_USER.id}`, {
                    method: 'POST',
                    body: { Title: 'Should fail', Type: 'Document' },
                })
            );
            expect(res.status).toBe(403);
        });

        it('unshared user gets 403 reading sources', async () => {
            const source = await createSourceAsOwner();

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const listRes = await LIST_SOURCES(
                createRequest(`http://localhost:3000/api/sources?ownerId=${TEST_USER.id}`)
            );
            expect(listRes.status).toBe(403);

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const getRes = await GET_SOURCE(
                createRequest(`http://localhost:3000/api/sources/${source.Id}?ownerId=${TEST_USER.id}`),
                { params: Promise.resolve({ id: String(source.Id) }) }
            );
            expect(getRes.status).toBe(403);
        });
    });

    it('returns 401 when unauthenticated', async () => {
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
        const res = await DELETE_SOURCE(
            createRequest('http://localhost:3000/api/sources/1', { method: 'DELETE' }),
            { params: Promise.resolve({ id: '1' }) }
        );
        expect(res.status).toBe(401);
    });
});
