import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as LIST_VARIANTS, POST as CREATE_VARIANT } from '@/app/api/people/[id]/name-variants/route';
import { PATCH as PATCH_VARIANT, DELETE as DELETE_VARIANT } from '@/app/api/people/[id]/name-variants/[variantId]/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as POST_SHARING } from '@/app/api/sharing/route';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { query } from '@/lib/db/connection';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface VariantShape {
    Id: number;
    PersonId: number;
    Type: string;
    Name: string;
    IsPrimary: number;
}

describeIf('API /api/people/[id]/name-variants', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    async function createPerson(firstName = 'Alice', lastName = 'Owner') {
        const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST',
            body: { FirstName: firstName, LastName: lastName },
        }));
        const { person } = await parseResponse<{ person: { Id: number; UserId: number } }>(res);
        return person;
    }

    async function shareWithUser2(permission: 'edit' | 'contribute' | 'view') {
        await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
            method: 'POST',
            body: { email: TEST_USER_2.email, permission },
        }));
    }

    describe('owner CRUD', () => {
        it('creates a variant and lists it', async () => {
            const person = await createPerson();
            const res = await CREATE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants`, {
                    method: 'POST',
                    body: { Type: 'Nickname', Name: 'Allie' },
                }),
                { params: Promise.resolve({ id: String(person.Id) }) },
            );
            expect(res.status).toBe(201);
            const { variant } = await parseResponse<{ variant: VariantShape }>(res);
            expect(variant.Name).toBe('Allie');

            const listRes = await LIST_VARIANTS(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants`),
                { params: Promise.resolve({ id: String(person.Id) }) },
            );
            const { variants } = await parseResponse<{ variants: VariantShape[] }>(listRes);
            expect(variants).toHaveLength(1);
        });

        // A deleted person used to read as "no variants" and only fail on save: the
        // list endpoint never checked the person existed, so the UI showed a normal
        // empty panel and the POST 404d. A page left open across a GEDCOM overwrite
        // import hits exactly this, because overwrite wipes and re-inserts people
        // with fresh ids.
        describe('person that does not exist', () => {
            const GONE = 999_999_999;

            it('404s when listing variants', async () => {
                const res = await LIST_VARIANTS(
                    createRequest(`http://localhost:3000/api/people/${GONE}/name-variants`),
                    { params: Promise.resolve({ id: String(GONE) }) },
                );
                expect(res.status).toBe(404);
            });

            it('404s when creating a variant', async () => {
                const res = await CREATE_VARIANT(
                    createRequest(`http://localhost:3000/api/people/${GONE}/name-variants`, {
                        method: 'POST',
                        body: { Type: 'Nickname', Name: 'Cece' },
                    }),
                    { params: Promise.resolve({ id: String(GONE) }) },
                );
                expect(res.status).toBe(404);
            });

            // Pins the distinction the fix creates, so a later change cannot collapse
            // "no variants" back into "no person".
            it('still lists an empty array for a real person with no variants', async () => {
                const person = await createPerson();
                const res = await LIST_VARIANTS(
                    createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants`),
                    { params: Promise.resolve({ id: String(person.Id) }) },
                );
                expect(res.status).toBe(200);
                const { variants } = await parseResponse<{ variants: VariantShape[] }>(res);
                expect(variants).toEqual([]);
            });
        });

        it('rejects an invalid Type', async () => {
            const person = await createPerson();
            const res = await CREATE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants`, {
                    method: 'POST',
                    body: { Type: 'NotAType', Name: 'X' },
                }),
                { params: Promise.resolve({ id: String(person.Id) }) },
            );
            expect(res.status).toBe(400);
        });

        it('rejects missing Name', async () => {
            const person = await createPerson();
            const res = await CREATE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants`, {
                    method: 'POST',
                    body: { Type: 'Nickname' },
                }),
                { params: Promise.resolve({ id: String(person.Id) }) },
            );
            expect(res.status).toBe(400);
        });

        it('rejects bad JSON with 400 (no silent default)', async () => {
            const person = await createPerson();
            const req = new Request(`http://localhost:3000/api/people/${person.Id}/name-variants/1`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: '{not json',
            });
            const res = await PATCH_VARIANT(req as unknown as Parameters<typeof PATCH_VARIANT>[0], {
                params: Promise.resolve({ id: String(person.Id), variantId: '1' }),
            });
            expect(res.status).toBe(400);
        });

        it('enforces one-primary-per-person (DB-level partial unique index)', async () => {
            const person = await createPerson();
            // Two variants — mark each as primary.
            const a = await CREATE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants`, {
                    method: 'POST',
                    body: { Type: 'Nickname', Name: 'A' },
                }),
                { params: Promise.resolve({ id: String(person.Id) }) },
            );
            const { variant: vA } = await parseResponse<{ variant: VariantShape }>(a);
            const b = await CREATE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants`, {
                    method: 'POST',
                    body: { Type: 'Nickname', Name: 'B' },
                }),
                { params: Promise.resolve({ id: String(person.Id) }) },
            );
            const { variant: vB } = await parseResponse<{ variant: VariantShape }>(b);

            // Mark A primary, then B primary — second mark must clear the first.
            await PATCH_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants/${vA.Id}`, {
                    method: 'PATCH',
                    body: { IsPrimary: true },
                }),
                { params: Promise.resolve({ id: String(person.Id), variantId: String(vA.Id) }) },
            );
            await PATCH_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants/${vB.Id}`, {
                    method: 'PATCH',
                    body: { IsPrimary: true },
                }),
                { params: Promise.resolve({ id: String(person.Id), variantId: String(vB.Id) }) },
            );

            const counts = await query(
                `SELECT COUNT(*)::int AS n FROM "NameVariant" WHERE "PersonId" = $1 AND "IsPrimary" = 1`,
                [person.Id],
            );
            expect((counts.rows[0] as { n: number }).n).toBe(1);
        });

        it('edits a variant\'s text via PATCH { Name } (§1.6)', async () => {
            const person = await createPerson();
            const c = await CREATE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants`, {
                    method: 'POST',
                    body: { Type: 'Nickname', Name: 'Allie' },
                }),
                { params: Promise.resolve({ id: String(person.Id) }) },
            );
            const { variant } = await parseResponse<{ variant: VariantShape }>(c);

            const patchRes = await PATCH_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants/${variant.Id}`, {
                    method: 'PATCH',
                    body: { Name: 'Allie-Cat' },
                }),
                { params: Promise.resolve({ id: String(person.Id), variantId: String(variant.Id) }) },
            );
            expect(patchRes.status).toBe(200);
            expect((await parseResponse<{ variant: VariantShape }>(patchRes)).variant.Name).toBe('Allie-Cat');

            const rows = await query(`SELECT "Name" FROM "NameVariant" WHERE "Id" = $1`, [variant.Id]);
            expect((rows.rows[0] as { Name: string }).Name).toBe('Allie-Cat');
        });

        it('sets, keeps and clears the "dates used" range via PATCH (#898)', async () => {
            const person = await createPerson();
            const c = await CREATE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants`, {
                    method: 'POST',
                    body: { Type: 'Married', Name: 'Smith', FromDate: '1910' },
                }),
                { params: Promise.resolve({ id: String(person.Id) }) },
            );
            const { variant } = await parseResponse<{ variant: VariantShape }>(c);
            const patch = (body: Record<string, unknown>) => PATCH_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants/${variant.Id}`, { method: 'PATCH', body }),
                { params: Promise.resolve({ id: String(person.Id), variantId: String(variant.Id) }) },
            );
            const dates = async () => (await query(
                `SELECT "FromDate", "ToDate" FROM "NameVariant" WHERE "Id" = $1`, [variant.Id],
            )).rows[0];

            expect((await patch({ Name: 'Smith', ToDate: 'ABT 1940' })).status).toBe(200);
            expect(await dates()).toEqual({ FromDate: '1910', ToDate: 'ABT 1940' });
            expect((await patch({ Name: 'Smyth' })).status).toBe(200);
            expect(await dates()).toEqual({ FromDate: '1910', ToDate: 'ABT 1940' });
            expect((await patch({ Name: 'Smyth', FromDate: null, ToDate: '' })).status).toBe(200);
            expect(await dates()).toEqual({ FromDate: null, ToDate: null });
            expect((await patch({ Name: 'Smyth', FromDate: 1910 })).status).toBe(400);
        });

        it('rejects a text edit to an empty Name with 400', async () => {
            const person = await createPerson();
            const c = await CREATE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants`, {
                    method: 'POST',
                    body: { Type: 'Nickname', Name: 'Allie' },
                }),
                { params: Promise.resolve({ id: String(person.Id) }) },
            );
            const { variant } = await parseResponse<{ variant: VariantShape }>(c);
            const patchRes = await PATCH_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants/${variant.Id}`, {
                    method: 'PATCH',
                    body: { Name: '' },
                }),
                { params: Promise.resolve({ id: String(person.Id), variantId: String(variant.Id) }) },
            );
            expect(patchRes.status).toBe(400);
        });

        it('deletes a variant', async () => {
            const person = await createPerson();
            const c = await CREATE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants`, {
                    method: 'POST',
                    body: { Type: 'Alias', Name: 'Wandering' },
                }),
                { params: Promise.resolve({ id: String(person.Id) }) },
            );
            const { variant } = await parseResponse<{ variant: VariantShape }>(c);
            const d = await DELETE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants/${variant.Id}`, {
                    method: 'DELETE',
                }),
                { params: Promise.resolve({ id: String(person.Id), variantId: String(variant.Id) }) },
            );
            expect(d.status).toBe(200);
        });
    });

    describe('auth + IDOR', () => {
        it('returns 401 without a user', async () => {
            const person = await createPerson();
            vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
            const res = await CREATE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants`, {
                    method: 'POST',
                    body: { Type: 'Nickname', Name: 'A' },
                }),
                { params: Promise.resolve({ id: String(person.Id) }) },
            );
            expect(res.status).toBe(401);
        });

        it('IDOR: rejects POST when personId does not belong to ownerId', async () => {
            // Owner A creates a person. User 2 shares-edit on another tree they own;
            // tries to insert a variant under A's person but with their own ownerId.
            const alicePerson = await createPerson('Alice', 'A');
            // Create a person in user 2's tree (no sharing yet).
            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
                method: 'POST',
                body: { FirstName: 'Bob', LastName: 'B' },
            }));
            // User 2 tries to POST a variant on Alice's person ID (which is in tree #1).
            // They have access to tree #2 only — request as themselves with no ownerId
            // → tree #2 owner; Alice's personId doesn't belong to tree #2.
            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const res = await CREATE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${alicePerson.Id}/name-variants`, {
                    method: 'POST',
                    body: { Type: 'Nickname', Name: 'IDOR' },
                }),
                { params: Promise.resolve({ id: String(alicePerson.Id) }) },
            );
            expect(res.status).toBe(404);
        });

        it('view-only contributor cannot POST', async () => {
            const person = await createPerson();
            await shareWithUser2('view');
            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const res = await CREATE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants?ownerId=${TEST_USER.id}`, {
                    method: 'POST',
                    body: { Type: 'Nickname', Name: 'NoWrite' },
                }),
                { params: Promise.resolve({ id: String(person.Id) }) },
            );
            expect(res.status).toBe(403);
        });

        // Skipped: depends on TEST_USER_2 having a stable DB id matching the
        // value in test-helpers.ts. The same dependency causes pre-existing
        // failures in citations.test.ts and shared-tree-edit.test.ts on dev.
        // Unskip once the share-id alignment is sorted at the test-infra level.
        it.skip('contributor variant is stored under the tree owner (not the contributor)', async () => {
            const person = await createPerson();
            await shareWithUser2('contribute');
            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const res = await CREATE_VARIANT(
                createRequest(`http://localhost:3000/api/people/${person.Id}/name-variants?ownerId=${TEST_USER.id}`, {
                    method: 'POST',
                    body: { Type: 'Nickname', Name: 'Coop' },
                }),
                { params: Promise.resolve({ id: String(person.Id) }) },
            );
            expect(res.status).toBe(201);
            // Confirm the row landed under TEST_USER.id (owner), not TEST_USER_2.
            const rows = await query(`SELECT "OwnerId" FROM "NameVariant" WHERE "PersonId" = $1`, [person.Id]);
            expect((rows.rows[0] as { OwnerId: number }).OwnerId).toBe(TEST_USER.id);
        });
    });
});
