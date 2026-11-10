import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as GET_CHECKS } from '@/app/api/data-checks/route';
import { POST as CONFIRM, DELETE as REOPEN } from '@/app/api/data-checks/confirmations/route';
import { GET as GET_NEIGHBOURHOOD } from '@/app/api/data-checks/neighbourhood/route';
import { GET as GET_AUDIT } from '@/app/api/audit/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { PUT as PUT_PERSON } from '@/app/api/people/[id]/route';
import { POST as CREATE_FAMILY } from '@/app/api/families/route';
import { POST as ADD_CHILD, PATCH as PATCH_CHILD } from '@/app/api/families/[id]/children/route';
import { POST as POST_SHARING } from '@/app/api/sharing/route';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import type { DataChecksResult } from '@/lib/data/types';
import type { DataCheckInput } from '@/lib/data-checks/rules';
import { dateClearsProblem } from '@/lib/data-checks/preview';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API /api/data-checks (#828)', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    async function seedDeathBeforeBirth() {
        const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST', body: { FirstName: 'Thomas', LastName: 'Kelly', BirthDate: '1851-03-14', DeathDate: 'ABT 1841' },
        }));
        return (await parseResponse<{ person: { Id: number } }>(res)).person;
    }

    it('returns 401 without a user', async () => {
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
        const res = await GET_CHECKS(createRequest('http://localhost:3000/api/data-checks'));
        expect(res.status).toBe(401);
    });

    it("computes the tree's problems, with the people they list", async () => {
        const thomas = await seedDeathBeforeBirth();
        const res = await GET_CHECKS(createRequest('http://localhost:3000/api/data-checks'));
        expect(res.status).toBe(200);
        const { problems, people } = await parseResponse<DataChecksResult>(res);
        expect(problems).toEqual([expect.objectContaining({
            id: `death_before_birth:${thomas.Id}`,
            kind: 'impossible',
            editable: [`PersonBirth:${thomas.Id}`, `PersonDeath:${thomas.Id}`],
        })]);
        expect(people).toEqual([expect.objectContaining({ Id: thomas.Id, FirstName: 'Thomas', LastName: 'Kelly' })]);
    });

    it("refuses another user's tree, and lets a viewer read it", async () => {
        await seedDeathBeforeBirth();
        const treeId = await resolveDefaultTree(TEST_USER.id);
        const url = `http://localhost:3000/api/data-checks?treeId=${treeId}`;

        vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
        expect((await GET_CHECKS(createRequest(url))).status).toBe(403);

        await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
            method: 'POST', body: { email: TEST_USER_2.email, permission: 'view' },
        }));
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
        const res = await GET_CHECKS(createRequest(url));
        expect(res.status).toBe(200);
        expect((await parseResponse<DataChecksResult>(res)).problems).toHaveLength(1);
    });

    it("lists each problem's families with their partners, to name a family filter (#831)", async () => {
        const create = async (body: Record<string, unknown>) => (await parseResponse<{ person: { Id: number } }>(
            await CREATE_PERSON(createRequest('http://localhost:3000/api/people', { method: 'POST', body })),
        )).person.Id;
        const mary = await create({ FirstName: 'Mary Ellen', LastName: 'Byrne', Sex: 'F', BirthDate: '1813', DeathDate: '1814-01-27' });
        const patrick = await create({ FirstName: 'Patrick', LastName: 'Doyle', Sex: 'M' });
        const bridget = await create({ FirstName: 'Bridget', LastName: 'Doyle', Sex: 'F', BirthDate: '1843-03-03' });
        const family = (await parseResponse<{ family: { Id: number } }>(
            await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', { method: 'POST', body: { Partner1Id: patrick, Partner2Id: mary } })),
        )).family;
        await ADD_CHILD(
            createRequest(`http://localhost:3000/api/families/${family.Id}/children`, { method: 'POST', body: { childId: bridget } }),
            { params: Promise.resolve({ id: String(family.Id) }) },
        );

        const { problems, people, families } = await parseResponse<DataChecksResult>(
            await GET_CHECKS(createRequest('http://localhost:3000/api/data-checks')),
        );
        expect(problems.map((p) => p.id)).toContain(`child_born_after_mother_death:${mary}`);
        expect(families).toEqual([{ Id: family.Id, Partner1Id: patrick, Partner2Id: mary }]);
        // Patrick isn't in any problem, but he names the family.
        expect(people.map((p) => p.Id).sort((a, b) => a - b)).toEqual([mary, patrick, bridget].sort((a, b) => a - b));
    });

    it("doesn't show one tree's problems in another", async () => {
        await seedDeathBeforeBirth();
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
        const res = await GET_CHECKS(createRequest('http://localhost:3000/api/data-checks'));
        expect(res.status).toBe(200);
        expect((await parseResponse<DataChecksResult>(res)).problems).toEqual([]);
    });

    describe('confirmations (#830)', () => {
        async function seedMotherOver55() {
            const create = async (body: Record<string, unknown>) => (await parseResponse<{ person: { Id: number } }>(
                await CREATE_PERSON(createRequest('http://localhost:3000/api/people', { method: 'POST', body })),
            )).person.Id;
            const anne = await create({ FirstName: 'Anne', LastName: 'Doyle', Sex: 'F', BirthDate: '1802-03-01' });
            const patrick = await create({ FirstName: 'Patrick', LastName: 'Doyle', Sex: 'M', BirthDate: '1858-03-01' });
            const family = (await parseResponse<{ family: { Id: number } }>(
                await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', { method: 'POST', body: { Partner2Id: anne } })),
            )).family;
            await ADD_CHILD(
                createRequest(`http://localhost:3000/api/families/${family.Id}/children`, { method: 'POST', body: { childId: patrick } }),
                { params: Promise.resolve({ id: String(family.Id) }) },
            );
            return { anne, patrick, familyId: family.Id, problemId: `mother_too_old:${anne}` };
        }
        const confirm = (problemId: string, reason: string, query = '') => CONFIRM(createRequest(
            `http://localhost:3000/api/data-checks/confirmations${query}`, { method: 'POST', body: { problemId, reason } },
        ));
        const reopen = (problemId: string, query = '') => REOPEN(createRequest(
            `http://localhost:3000/api/data-checks/confirmations?problemId=${encodeURIComponent(problemId)}${query}`, { method: 'DELETE' },
        ));
        const entry = async (problemId: string, query = '') => (await parseResponse<DataChecksResult>(
            await GET_CHECKS(createRequest(`http://localhost:3000/api/data-checks${query}`)),
        )).problems.find((p) => p.id === problemId);

        it('confirms, reopens and confirms again, each audited', async () => {
            const { problemId } = await seedMotherOver55();
            expect((await entry(problemId))?.confirmation).toBeNull();

            expect((await confirm(problemId, '')).status).toBe(400);
            expect((await confirm(problemId, 'Both years are in the register.')).status).toBe(200);
            expect((await entry(problemId))?.confirmation?.reason).toBe('Both years are in the register.');

            expect((await reopen(problemId)).status).toBe(200);
            expect((await entry(problemId))?.confirmation).toBeNull();
            expect((await reopen(problemId)).status).toBe(404);

            expect((await confirm(problemId, 'Checked again.')).status).toBe(200);
            expect((await entry(problemId))?.confirmation?.reason).toBe('Checked again.');

            const audit = await parseResponse<{ entries: Array<{ EntityType: string; Action: string }> }>(
                await GET_AUDIT(createRequest('http://localhost:3000/api/audit?entityType=datacheck')),
            );
            expect(audit.entries.filter((e) => e.EntityType === 'datacheck').map((e) => e.Action).sort())
                .toEqual(['create', 'create', 'delete']);
        });

        it('stops applying when the link turns out to be an adoption, and the preview agrees (#841)', async () => {
            const { anne, patrick, familyId, problemId } = await seedMotherOver55();
            expect((await confirm(problemId, 'Both years are in the register.')).status).toBe(200);

            const res = await PATCH_CHILD(
                createRequest(`http://localhost:3000/api/families/${familyId}/children`, {
                    method: 'PATCH', body: { childId: patrick, relationshipType: 'Adoption' },
                }),
                { params: Promise.resolve({ id: String(familyId) }) },
            );
            expect(res.status).toBe(200);
            expect(await entry(problemId)).toBeUndefined();

            const { neighbourhood } = await parseResponse<{ neighbourhood: DataCheckInput }>(await GET_NEIGHBOURHOOD(
                createRequest(`http://localhost:3000/api/data-checks/neighbourhood?personId=${anne}`),
            ));
            expect(neighbourhood.families.map((f) => [f.partner1NonBirthChildIds, f.partner2NonBirthChildIds])).toEqual([[[patrick], [patrick]]]);
        });

        it('refuses to confirm an impossible check', async () => {
            const thomas = await seedDeathBeforeBirth();
            expect((await confirm(`death_before_birth:${thomas.Id}`, 'Late registration')).status).toBe(400);
        });

        it('lets a viewer read Confirmed but not change it', async () => {
            const { problemId } = await seedMotherOver55();
            await confirm(problemId, 'Both years are in the register.');
            const treeId = await resolveDefaultTree(TEST_USER.id);
            await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
                method: 'POST', body: { email: TEST_USER_2.email, permission: 'view' },
            }));

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            expect((await entry(problemId, `?treeId=${treeId}`))?.confirmation?.reason).toBe('Both years are in the register.');
            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            expect((await confirm(problemId, 'Mine', `?treeId=${treeId}`)).status).toBe(403);
            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            expect((await reopen(problemId, `&treeId=${treeId}`)).status).toBe(403);
        });

        it("keeps another tree's confirmations invisible", async () => {
            const { problemId } = await seedMotherOver55();
            await confirm(problemId, 'Both years are in the register.');
            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            expect(await entry(problemId)).toBeUndefined();
            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            expect((await reopen(problemId)).status).toBe(404);
        });

        it('expires when one of the involved dates is edited', async () => {
            const { patrick, problemId } = await seedMotherOver55();
            await confirm(problemId, 'Both years are in the register.');
            await PUT_PERSON(
                createRequest(`http://localhost:3000/api/people/${patrick}`, { method: 'PUT', body: { BirthDate: '1858-04-01' } }),
                { params: Promise.resolve({ id: String(patrick) }) },
            );
            const e = await entry(problemId);
            expect(e?.kind).toBe('unlikely');
            expect(e?.confirmation).toBeNull();
        });
    });

    it("narrows the list to one person's dates to fix, or to one family (#833)", async () => {
        const thomas = await seedDeathBeforeBirth();
        const other = await seedDeathBeforeBirth();
        const listWith = async (query: string) => (await parseResponse<DataChecksResult>(
            await GET_CHECKS(createRequest(`http://localhost:3000/api/data-checks?${query}`)),
        )).problems.map((p) => p.personId);
        expect((await listWith('')).sort()).toEqual([thomas.Id, other.Id].sort());
        expect(await listWith(`personId=${thomas.Id}`)).toEqual([thomas.Id]);
        const family = (await parseResponse<{ family: { Id: number } }>(
            await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', { method: 'POST', body: { Partner1Id: other.Id } })),
        )).family;
        // Death before birth involves no family, so the family's list is empty.
        expect(await listWith(`familyId=${family.Id}`)).toEqual([]);

        const mary = (await parseResponse<{ person: { Id: number } }>(await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST', body: { FirstName: 'Mary Ellen', LastName: 'Byrne', Sex: 'F', BirthDate: '1813', DeathDate: '1814-01-27' },
        })))).person.Id;
        const bridget = (await parseResponse<{ person: { Id: number } }>(await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST', body: { FirstName: 'Bridget', LastName: 'Doyle', Sex: 'F', BirthDate: '1843-03-03' },
        })))).person.Id;
        const byrne = (await parseResponse<{ family: { Id: number } }>(
            await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', { method: 'POST', body: { Partner1Id: mary } })),
        )).family;
        await ADD_CHILD(
            createRequest(`http://localhost:3000/api/families/${byrne.Id}/children`, { method: 'POST', body: { childId: bridget } }),
            { params: Promise.resolve({ id: String(byrne.Id) }) },
        );
        const byFamily = await listWith(`familyId=${byrne.Id}`);
        expect(byFamily.length).toBeGreaterThan(0);
        expect(new Set(byFamily)).toEqual(new Set([mary]));
    });

    describe('fixing a date in place (#832)', () => {
        const neighbourhoodOf = (personId: number | string, query = '') =>
            GET_NEIGHBOURHOOD(createRequest(`http://localhost:3000/api/data-checks/neighbourhood?personId=${personId}${query}`));

        it("returns only the person's partners, children and their dates, to any reader", async () => {
            const thomas = await seedDeathBeforeBirth();
            const other = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
                method: 'POST', body: { FirstName: 'Unrelated', LastName: 'Person', BirthDate: '1900' },
            }));
            expect(other.status).toBe(201);

            const res = await neighbourhoodOf(thomas.Id);
            expect(res.status).toBe(200);
            const { neighbourhood } = await parseResponse<{ neighbourhood: DataCheckInput }>(res);
            expect(neighbourhood.people.map((p) => p.Id)).toEqual([thomas.Id]);
            expect(neighbourhood.families).toEqual([]);

            expect((await neighbourhoodOf('')).status).toBe(400);
            expect((await neighbourhoodOf(999999)).status).toBe(404);

            const treeId = await resolveDefaultTree(TEST_USER.id);
            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            expect((await neighbourhoodOf(thomas.Id, `&treeId=${treeId}`)).status).toBe(403);
            vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
            expect((await neighbourhoodOf(thomas.Id)).status).toBe(401);
        });

        it('previews the fix, saves it audited, and the list drops by one', async () => {
            const thomas = await seedDeathBeforeBirth();
            await seedDeathBeforeBirth();
            const list = async () => (await parseResponse<DataChecksResult>(
                await GET_CHECKS(createRequest('http://localhost:3000/api/data-checks')),
            )).problems;
            const before = await list();
            expect(before).toHaveLength(2);
            const problem = before.find((p) => p.personId === thomas.Id)!;
            const death = problem.facts.find((f) => f.key === `PersonDeath:${thomas.Id}`)!;

            const { neighbourhood } = await parseResponse<{ neighbourhood: DataCheckInput }>(await neighbourhoodOf(thomas.Id));
            expect(dateClearsProblem(neighbourhood, problem.id, death, '1840')).toBe(false);
            expect(dateClearsProblem(neighbourhood, problem.id, death, '1911')).toBe(true);

            const saved = await PUT_PERSON(
                createRequest(`http://localhost:3000/api/people/${thomas.Id}`, { method: 'PUT', body: { DeathDate: '1911' } }),
                { params: Promise.resolve({ id: String(thomas.Id) }) },
            );
            expect(saved.status).toBe(200);
            const after = await list();
            expect(after).toHaveLength(1);
            expect(after.some((p) => p.id === problem.id)).toBe(false);

            const audit = await parseResponse<{ entries: Array<{ EntityType: string; EntityId: number; Action: string }> }>(
                await GET_AUDIT(createRequest('http://localhost:3000/api/audit?entityType=person')),
            );
            expect(audit.entries.some((e) => e.EntityId === thomas.Id && e.Action === 'update')).toBe(true);
        });
    });
});
