import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as GET_DASHBOARD } from '@/app/api/dashboard/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as CREATE_SOURCE } from '@/app/api/sources/route';
import { POST as CREATE_EVENT } from '@/app/api/events/route';
import { POST as CREATE_CITATION } from '@/app/api/citations/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface DashboardResponse {
    stats: { people: number; families: number; events: number; sources: number };
}

describeIf('API /api/dashboard', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    it('returns 401 without a user', async () => {
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
        const res = await GET_DASHBOARD(createRequest('http://localhost:3000/api/dashboard'));
        expect(res.status).toBe(401);
    });

    it('returns counts matching seeded data, with correct UserId / OwnerId mapping per entity', async () => {
        await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST', body: { FirstName: 'P1', LastName: 'X' },
        }));
        await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST', body: { FirstName: 'P2', LastName: 'Y' },
        }));
        await CREATE_SOURCE(createRequest('http://localhost:3000/api/sources', {
            method: 'POST', body: { Title: 'S1', Type: 'Census' },
        }));

        const res = await GET_DASHBOARD(createRequest('http://localhost:3000/api/dashboard'));
        expect(res.status).toBe(200);
        const data = await parseResponse<DashboardResponse>(res);
        // People uses UserId, Sources uses OwnerId — both must resolve to TEST_USER.id.
        expect(data.stats.people).toBe(2);
        expect(data.stats.sources).toBe(1);
    });

    it('resume card counts sourced facts like the person hero, birth and death citations included', async () => {
        const req = (path: string, body: Record<string, unknown>) =>
            createRequest(`http://localhost:3000/api/${path}`, { method: 'POST', body });
        const { person } = await parseResponse<{ person: { Id: number } }>(await CREATE_PERSON(
            req('people', { FirstName: 'Mara', LastName: 'Linden', BirthDate: '1889', DeathDate: '1960' })));
        const { source } = await parseResponse<{ source: { Id: number } }>(await CREATE_SOURCE(
            req('sources', { Title: 'Parish register', Type: 'Church' })));
        const { event: occupation } = await parseResponse<{ event: { Id: number } }>(await CREATE_EVENT(
            req('events', { Type: 'OCCU', PersonId: person.Id })));
        await CREATE_EVENT(req('events', { Type: 'RESI', PersonId: person.Id }));
        const cite = async (FactTable: string, FactId: number) => {
            const res = await CREATE_CITATION(req('citations', { FactTable, FactId, SourceId: source.Id }));
            expect(res.status).toBe(201);
        };

        const resume = async () => {
            const data = await parseResponse<{ resumedPerson: { Id: number; totalFacts: number; sourcedFacts: number } }>(
                await GET_DASHBOARD(createRequest('http://localhost:3000/api/dashboard')));
            return data.resumedPerson;
        };

        // Birth only: the old pill counted just People/Events citations and showed nothing.
        await cite('PersonBirth', person.Id);
        expect(await resume()).toMatchObject({ Id: person.Id, totalFacts: 4, sourcedFacts: 1 });

        // Two citations on one event are still one sourced fact.
        await cite('Events', occupation.Id);
        await cite('Events', occupation.Id);
        expect(await resume()).toMatchObject({ totalFacts: 4, sourcedFacts: 2 });

        await cite('PersonDeath', person.Id);
        expect(await resume()).toMatchObject({ totalFacts: 4, sourcedFacts: 3 });
    });

    it('lists other recently edited people newest first, each once, skipping the resumed one (#1061)', async () => {
        const create = async (FirstName: string) => (await parseResponse<{ person: { Id: number } }>(await CREATE_PERSON(
            createRequest('http://localhost:3000/api/people', { method: 'POST', body: { FirstName, LastName: 'Halvorsen' } })))).person.Id;
        const anders = await create('Anders');
        const ingrid = await create('Ingrid');
        const nils = await create('Nils');

        const data = await parseResponse<{
            stats: { casesInProgress: number };
            resumedPerson: { Id: number };
            recentPeople: Array<{ Id: number; FirstName: string; lastChange: { Action: string } }>;
        }>(await GET_DASHBOARD(createRequest('http://localhost:3000/api/dashboard')));
        expect(data.resumedPerson.Id).toBe(nils);
        expect(data.recentPeople.map(p => p.Id)).toEqual([ingrid, anders]);
        expect(data.recentPeople[0]).toMatchObject({ FirstName: 'Ingrid', lastChange: { Action: 'create' } });
        expect(data.stats.casesInProgress).toBe(0);
    });
});
