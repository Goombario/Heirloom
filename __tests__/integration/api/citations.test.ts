import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as LIST_CITATIONS, POST as CREATE_CITATION } from '@/app/api/citations/route';
import { DELETE as DELETE_CITATION, PUT as UPDATE_CITATION } from '@/app/api/citations/[id]/route';
import { POST as CREATE_CITATIONS } from '@/app/api/citations/bulk/route';
import { GET as LIST_SOURCES, POST as CREATE_SOURCE } from '@/app/api/sources/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as CREATE_FAMILY } from '@/app/api/families/route';
import { POST as CREATE_EVENT } from '@/app/api/events/route';
import { POST as CREATE_CASE } from '@/app/api/cases/route';
import { GET as GET_CASE, PUT as UPDATE_CASE } from '@/app/api/cases/[id]/route';
import { POST as CREATE_COMMENT } from '@/app/api/cases/[id]/comments/route';
import { POST as CREATE_TREE } from '@/app/api/trees/route';
import { POST as POST_SHARING } from '@/app/api/sharing/route';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface CitationShape {
    Id: number;
    OwnerId: number;
    FactTable: string;
    FactId: number;
    SourceId: number;
    Quay?: string | null;
    DataText?: string | null;
}

describeIf('API /api/citations', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    async function createPerson() {
        const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST',
            body: { FirstName: 'Alice', LastName: 'Owner' },
        }));
        const { person } = await parseResponse<{ person: { Id: number } }>(res);
        return person;
    }

    async function createSource(ownerQuery = '') {
        const res = await CREATE_SOURCE(createRequest(`http://localhost:3000/api/sources${ownerQuery}`, {
            method: 'POST',
            body: { Title: 'Census 1881', Type: 'Census' },
        }));
        const { source } = await parseResponse<{ source: { Id: number } }>(res);
        return source;
    }

    async function shareWithUser2(permission: 'edit' | 'contribute' | 'view') {
        await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
            method: 'POST',
            body: { email: TEST_USER_2.email, permission },
        }));
    }

    describe('owner flows', () => {
        it('creates a citation under the owner and reads it back', async () => {
            const person = await createPerson();
            const source = await createSource();

            const res = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST',
                body: { FactTable: 'People', FactId: person.Id, SourceId: source.Id, Page: 'p.4' },
            }));
            expect(res.status).toBe(201);
            const { citation } = await parseResponse<{ citation: CitationShape }>(res);
            expect(citation.OwnerId).toBe(TEST_USER.id);

            const factRes = await LIST_CITATIONS(
                createRequest(`http://localhost:3000/api/citations?factTable=People&factId=${person.Id}`)
            );
            const { citations } = await parseResponse<{ citations: CitationShape[] }>(factRes);
            expect(citations).toHaveLength(1);

            const personRes = await LIST_CITATIONS(
                createRequest(`http://localhost:3000/api/citations?personId=${person.Id}`)
            );
            const { citationMap } = await parseResponse<{ citationMap: Record<string, CitationShape[]> }>(personRes);
            expect(citationMap[`People:${person.Id}`]).toHaveLength(1);
        });

        it('persists certainty (QUAY) and transcription, trimming the transcript', async () => {
            const person = await createPerson();
            const source = await createSource();

            const res = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST',
                body: {
                    FactTable: 'People', FactId: person.Id, SourceId: source.Id,
                    Page: 'p.4', Quay: '3', DataText: '  born 12 May 1873  ',
                },
            }));
            expect(res.status).toBe(201);
            const { citation } = await parseResponse<{ citation: CitationShape }>(res);
            expect(citation.Quay).toBe('3');
            expect(citation.DataText).toBe('born 12 May 1873');

            const factRes = await LIST_CITATIONS(
                createRequest(`http://localhost:3000/api/citations?factTable=People&factId=${person.Id}`)
            );
            const { citations } = await parseResponse<{ citations: CitationShape[] }>(factRes);
            expect(citations[0].Quay).toBe('3');
            expect(citations[0].DataText).toBe('born 12 May 1873');
        });

        it('loads family-record and persisted family-event citations together', async () => {
            const familyRes = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
                method: 'POST', body: { Type: 'Marriage' },
            }));
            const { family } = await parseResponse<{ family: { Id: number } }>(familyRes);
            const eventRes = await CREATE_EVENT(createRequest('http://localhost:3000/api/events', {
                method: 'POST', body: { Type: 'DIV', Date: '1920', FamilyId: family.Id },
            }));
            const { event } = await parseResponse<{ event: { Id: number } }>(eventRes);
            const source = await createSource();

            for (const fact of [
                { FactTable: 'Families', FactId: family.Id },
                { FactTable: 'Events', FactId: event.Id },
            ]) {
                const response = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                    method: 'POST', body: { ...fact, SourceId: source.Id },
                }));
                expect(response.status).toBe(201);
            }

            const response = await LIST_CITATIONS(createRequest(`http://localhost:3000/api/citations?familyId=${family.Id}`));
            const { citationMap } = await parseResponse<{ citationMap: Record<string, CitationShape[]> }>(response);
            expect(citationMap[`Families:${family.Id}`]).toHaveLength(1);
            expect(citationMap[`Events:${event.Id}`]).toHaveLength(1);
        });

        it('persists evidence on a case-comment citation', async () => {
            const caseRes = await CREATE_CASE(createRequest('http://localhost:3000/api/cases', {
                method: 'POST', body: { Title: 'Evidence case' },
            }));
            const { case: researchCase } = await parseResponse<{ case: { Id: number } }>(caseRes);
            const commentRes = await CREATE_COMMENT(
                createRequest(`http://localhost:3000/api/cases/${researchCase.Id}/comments`, { method: 'POST', body: { body: 'Journal entry' } }),
                { params: Promise.resolve({ id: String(researchCase.Id) }) },
            );
            const { comment } = await parseResponse<{ comment: { Id: number } }>(commentRes);
            const source = await createSource();

            const createRes = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST', body: { FactTable: 'CaseComments', FactId: comment.Id, SourceId: source.Id, Page: 'folio 9', Quay: '2', DataText: 'Exact entry' },
            }));
            expect(createRes.status).toBe(201);
            const { citation } = await parseResponse<{ citation: CitationShape & { Page: string | null } }>(createRes);
            expect(citation).toMatchObject({ Page: 'folio 9', Quay: '2', DataText: 'Exact entry' });
        });

        it("loads a case citation's page, certainty and transcription with the case (#918)", async () => {
            const caseRes = await CREATE_CASE(createRequest('http://localhost:3000/api/cases', {
                method: 'POST', body: { Title: 'Sourced case' },
            }));
            const { case: researchCase } = await parseResponse<{ case: { Id: number } }>(caseRes);
            const source = await createSource();
            const createRes = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST', body: { FactTable: 'Cases', FactId: researchCase.Id, SourceId: source.Id, Page: 'folio 9', Quay: '3', DataText: 'Exact entry' },
            }));
            expect(createRes.status).toBe(201);

            const getRes = await GET_CASE(
                createRequest(`http://localhost:3000/api/cases/${researchCase.Id}`),
                { params: Promise.resolve({ id: String(researchCase.Id) }) },
            );
            const { case: loaded } = await parseResponse<{ case: { citations: Array<Record<string, unknown>> } }>(getRes);
            expect(loaded.citations).toHaveLength(1);
            expect(loaded.citations[0]).toMatchObject({
                CaseId: researchCase.Id, SourceId: source.Id, Page: 'folio 9', Quay: '3', DataText: 'Exact entry', sourceType: 'Census',
            });
        });

        it('rejects a case-comment citation whose owning case is in another tree', async () => {
            const treeARes = await CREATE_TREE(createRequest('http://localhost:3000/api/trees', { method: 'POST', body: { name: 'Citation tree A' } }));
            const treeBRes = await CREATE_TREE(createRequest('http://localhost:3000/api/trees', { method: 'POST', body: { name: 'Citation tree B' } }));
            const { tree: treeA } = await parseResponse<{ tree: { Id: number } }>(treeARes);
            const { tree: treeB } = await parseResponse<{ tree: { Id: number } }>(treeBRes);
            const caseRes = await CREATE_CASE(createRequest(`http://localhost:3000/api/cases?treeId=${treeA.Id}`, { method: 'POST', body: { Title: 'Tree A case' } }));
            const { case: researchCase } = await parseResponse<{ case: { Id: number } }>(caseRes);
            const commentRes = await CREATE_COMMENT(
                createRequest(`http://localhost:3000/api/cases/${researchCase.Id}/comments?treeId=${treeA.Id}`, { method: 'POST', body: { body: 'Tree A entry' } }),
                { params: Promise.resolve({ id: String(researchCase.Id) }) },
            );
            const { comment } = await parseResponse<{ comment: { Id: number } }>(commentRes);
            const sourceRes = await CREATE_SOURCE(createRequest(`http://localhost:3000/api/sources?treeId=${treeB.Id}`, { method: 'POST', body: { Title: 'Tree B source' } }));
            const { source } = await parseResponse<{ source: { Id: number } }>(sourceRes);

            const response = await CREATE_CITATION(createRequest(`http://localhost:3000/api/citations?treeId=${treeB.Id}`, {
                method: 'POST', body: { FactTable: 'CaseComments', FactId: comment.Id, SourceId: source.Id },
            }));
            expect(response.status).toBe(404);
        });

        it('rejects an out-of-range QUAY value with 400', async () => {
            const person = await createPerson();
            const source = await createSource();
            const res = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST',
                body: { FactTable: 'People', FactId: person.Id, SourceId: source.Id, Quay: '7' },
            }));
            expect(res.status).toBe(400);
        });

        it('rejects a citation missing required fields', async () => {
            const res = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST',
                body: { FactTable: 'People' },
            }));
            expect(res.status).toBe(400);
        });

        it('rejects FactTable values not in FACT_TABLES', async () => {
            const res = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST',
                body: { FactTable: 'person', FactId: 1, SourceId: 1 },
            }));
            expect(res.status).toBe(400);
        });

        it('returns 404 when the SourceId is not in this tree (IDOR guard)', async () => {
            const person = await createPerson();
            // SourceId 99999 doesn't exist for this owner.
            const res = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST',
                body: { FactTable: 'People', FactId: person.Id, SourceId: 99999 },
            }));
            expect(res.status).toBe(404);
        });

        it('rejects citing a closed case with 403', async () => {
            // Restore the closed-case 403 rule from the deleted case-citation test.
            const source = await createSource();
            const caseRes = await CREATE_CASE(createRequest('http://localhost:3000/api/cases', {
                method: 'POST',
                body: { Title: 'Frozen Case' },
            }));
            const { case: closedCase } = await parseResponse<{ case: { Id: number } }>(caseRes);
            await UPDATE_CASE(
                createRequest(`http://localhost:3000/api/cases/${closedCase.Id}`, {
                    method: 'PUT',
                    body: { Status: 'closed', Conclusion: 'Answered.' },
                }),
                { params: Promise.resolve({ id: String(closedCase.Id) }) },
            );

            const res = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST',
                body: { FactTable: 'Cases', FactId: closedCase.Id, SourceId: source.Id },
            }));
            expect(res.status).toBe(403);
        });

        it('deletes its own citation', async () => {
            const person = await createPerson();
            const source = await createSource();
            const createRes = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST',
                body: { FactTable: 'People', FactId: person.Id, SourceId: source.Id },
            }));
            const { citation } = await parseResponse<{ citation: CitationShape }>(createRes);

            const delRes = await DELETE_CITATION(
                createRequest(`http://localhost:3000/api/citations/${citation.Id}`, { method: 'DELETE' }),
                { params: Promise.resolve({ id: String(citation.Id) }) }
            );
            expect(delRes.status).toBe(200);
        });

        it('PUT updates Page/Quay/DataText and reads the new values back', async () => {
            const person = await createPerson();
            const source = await createSource();
            const createRes = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST',
                body: { FactTable: 'People', FactId: person.Id, SourceId: source.Id, Page: 'p.1', Quay: '2' },
            }));
            const { citation } = await parseResponse<{ citation: CitationShape }>(createRes);

            const res = await UPDATE_CITATION(
                createRequest(`http://localhost:3000/api/citations/${citation.Id}`, {
                    method: 'PUT',
                    body: { Page: 'p.412', Quay: '3', DataText: '  exact wording  ' },
                }),
                { params: Promise.resolve({ id: String(citation.Id) }) }
            );
            expect(res.status).toBe(200);
            const { citation: updated } = await parseResponse<{ citation: CitationShape & { Page: string | null; DataText: string | null } }>(res);
            expect(updated.Page).toBe('p.412');
            expect(updated.Quay).toBe('3');
            expect(updated.DataText).toBe('exact wording');
        });

        it('stores, edits, keeps and clears a record link (#1023)', async () => {
            const person = await createPerson();
            const source = await createSource();
            const createRes = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST',
                body: { FactTable: 'People', FactId: person.Id, SourceId: source.Id, Url: '  https://records.example.org/entry/1  ' },
            }));
            expect(createRes.status).toBe(201);
            const { citation } = await parseResponse<{ citation: CitationShape & { Url: string | null } }>(createRes);
            expect(citation.Url).toBe('https://records.example.org/entry/1');

            const put = async (body: Record<string, unknown>) => {
                const res = await UPDATE_CITATION(
                    createRequest(`http://localhost:3000/api/citations/${citation.Id}`, { method: 'PUT', body }),
                    { params: Promise.resolve({ id: String(citation.Id) }) }
                );
                return { status: res.status, body: await parseResponse<{ citation: { Url: string | null; Page: string | null } }>(res) };
            };

            const edited = await put({ Page: 'p.2', Url: 'https://records.example.org/entry/2' });
            expect(edited.body.citation.Url).toBe('https://records.example.org/entry/2');
            // A caller that doesn't send Url keeps the stored link.
            const kept = await put({ Page: 'p.3' });
            expect(kept.body.citation).toMatchObject({ Page: 'p.3', Url: 'https://records.example.org/entry/2' });
            const cleared = await put({ Page: 'p.3', Url: '' });
            expect(cleared.body.citation.Url).toBeNull();
            // Export writes the link as one GEDCOM value, so a line break is refused.
            expect((await put({ Page: 'p.3', Url: 'https://a.example\n1 _EVIL x' })).status).toBe(400);
            expect((await put({ Page: 'p.3', Url: 'https://a.example\u20281 _EVIL x' })).status).toBe(400);
            expect((await put({ Page: 'p.3', Url: `https://a.example/${'x'.repeat(4096)}` })).status).toBe(400);

            const listRes = await LIST_CITATIONS(createRequest(`http://localhost:3000/api/citations?factTable=People&factId=${person.Id}`));
            const { citations } = await parseResponse<{ citations: Array<{ Url: string | null }> }>(listRes);
            expect(citations[0].Url).toBeNull();
        });

        it('PUT returns 401 when unauthenticated', async () => {
            vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
            const res = await UPDATE_CITATION(
                createRequest('http://localhost:3000/api/citations/1', { method: 'PUT', body: { Page: 'x' } }),
                { params: Promise.resolve({ id: '1' }) }
            );
            expect(res.status).toBe(401);
        });

        it('PUT returns 404 for a citation not in this tree', async () => {
            const res = await UPDATE_CITATION(
                createRequest('http://localhost:3000/api/citations/99999999', { method: 'PUT', body: { Page: 'x' } }),
                { params: Promise.resolve({ id: '99999999' }) }
            );
            expect(res.status).toBe(404);
        });

        it('PUT rejects an out-of-range QUAY value with 400', async () => {
            const person = await createPerson();
            const source = await createSource();
            const createRes = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST',
                body: { FactTable: 'People', FactId: person.Id, SourceId: source.Id },
            }));
            const { citation } = await parseResponse<{ citation: CitationShape }>(createRes);
            const res = await UPDATE_CITATION(
                createRequest(`http://localhost:3000/api/citations/${citation.Id}`, { method: 'PUT', body: { Quay: '9' } }),
                { params: Promise.resolve({ id: String(citation.Id) }) }
            );
            expect(res.status).toBe(400);
        });
    });

    describe('bulk cite (#799)', () => {
        it('cites one source on several births in one request, then lists it as recently cited', async () => {
            const people = [await createPerson(), await createPerson(), await createPerson()];
            const source = await createSource();

            const res = await CREATE_CITATIONS(createRequest('http://localhost:3000/api/citations/bulk', {
                method: 'POST',
                body: {
                    SourceId: source.Id,
                    Page: 'Folio 3',
                    Quay: '2',
                    facts: people.map((p, i) => ({ FactTable: 'PersonBirth', FactId: p.Id, Page: i === 2 ? 'Folio 3, line 9' : undefined })),
                },
            }));
            expect(res.status).toBe(201);
            const { citations } = await parseResponse<{ citations: (CitationShape & { Page: string | null })[] }>(res);
            expect(citations.map(c => [c.FactId, c.Page, c.Quay])).toEqual([
                [people[0].Id, 'Folio 3', '2'],
                [people[1].Id, 'Folio 3', '2'],
                [people[2].Id, 'Folio 3, line 9', '2'],
            ]);

            const recentRes = await LIST_SOURCES(createRequest('http://localhost:3000/api/sources?recent=true'));
            const { sources } = await parseResponse<{ sources: { Id: number }[] }>(recentRes);
            expect(sources.map(s => s.Id)).toEqual([source.Id]);
        });

        it('writes nothing when one fact is in another tree', async () => {
            const person = await createPerson();
            const source = await createSource();
            const treeRes = await CREATE_TREE(createRequest('http://localhost:3000/api/trees', { method: 'POST', body: { name: 'Other' } }));
            const { tree } = await parseResponse<{ tree: { Id: number } }>(treeRes);
            const strangerRes = await CREATE_PERSON(createRequest(`http://localhost:3000/api/people?treeId=${tree.Id}`, {
                method: 'POST', body: { FirstName: 'Zed', LastName: 'Elsewhere' },
            }));
            const { person: stranger } = await parseResponse<{ person: { Id: number } }>(strangerRes);

            const res = await CREATE_CITATIONS(createRequest('http://localhost:3000/api/citations/bulk', {
                method: 'POST',
                body: { SourceId: source.Id, facts: [{ FactTable: 'PersonBirth', FactId: person.Id }, { FactTable: 'PersonBirth', FactId: stranger.Id }] },
            }));
            expect(res.status).toBe(404);
            const listRes = await LIST_CITATIONS(createRequest(`http://localhost:3000/api/citations?personId=${person.Id}`));
            const { citationMap } = await parseResponse<{ citationMap: Record<string, unknown[]> }>(listRes);
            expect(citationMap).toEqual({});
        });
    });

    describe('shared-tree access', () => {
        it('contributor citation is stored under the tree owner (not the contributor)', async () => {
            const person = await createPerson();
            const source = await createSource();
            await shareWithUser2('contribute');

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const res = await CREATE_CITATION(
                createRequest(`http://localhost:3000/api/citations?ownerId=${TEST_USER.id}`, {
                    method: 'POST',
                    body: { FactTable: 'People', FactId: person.Id, SourceId: source.Id },
                })
            );
            expect(res.status).toBe(201);
            const { citation } = await parseResponse<{ citation: CitationShape }>(res);
            // Regression guard: previously hardcoded to the creator's id, orphaning it.
            expect(citation.OwnerId).toBe(TEST_USER.id);
        });

        it('viewer reads owner citations via ownerId', async () => {
            const person = await createPerson();
            const source = await createSource();
            await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST',
                body: { FactTable: 'People', FactId: person.Id, SourceId: source.Id },
            }));
            await shareWithUser2('view');

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const res = await LIST_CITATIONS(
                createRequest(`http://localhost:3000/api/citations?factTable=People&factId=${person.Id}&ownerId=${TEST_USER.id}`)
            );
            expect(res.status).toBe(200);
            const { citations } = await parseResponse<{ citations: CitationShape[] }>(res);
            expect(citations).toHaveLength(1);
        });

        it('view-only user gets 403 creating a citation', async () => {
            const person = await createPerson();
            const source = await createSource();
            await shareWithUser2('view');

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const res = await CREATE_CITATION(
                createRequest(`http://localhost:3000/api/citations?ownerId=${TEST_USER.id}`, {
                    method: 'POST',
                    body: { FactTable: 'People', FactId: person.Id, SourceId: source.Id },
                })
            );
            expect(res.status).toBe(403);
        });

        it('view-only user gets 403 deleting a citation', async () => {
            const person = await createPerson();
            const source = await createSource();
            const createRes = await CREATE_CITATION(createRequest('http://localhost:3000/api/citations', {
                method: 'POST',
                body: { FactTable: 'People', FactId: person.Id, SourceId: source.Id },
            }));
            const { citation } = await parseResponse<{ citation: CitationShape }>(createRes);
            await shareWithUser2('view');

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const res = await DELETE_CITATION(
                createRequest(`http://localhost:3000/api/citations/${citation.Id}?ownerId=${TEST_USER.id}`, { method: 'DELETE' }),
                { params: Promise.resolve({ id: String(citation.Id) }) }
            );
            expect(res.status).toBe(403);
        });

        it('view-only user gets 403 citing many facts', async () => {
            const person = await createPerson();
            const source = await createSource();
            await shareWithUser2('view');

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const res = await CREATE_CITATIONS(
                createRequest(`http://localhost:3000/api/citations/bulk?ownerId=${TEST_USER.id}`, {
                    method: 'POST',
                    body: { SourceId: source.Id, facts: [{ FactTable: 'PersonBirth', FactId: person.Id }] },
                })
            );
            expect(res.status).toBe(403);
        });

        it('unshared user gets 403 creating a citation', async () => {
            const person = await createPerson();
            const source = await createSource();

            vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
            const res = await CREATE_CITATION(
                createRequest(`http://localhost:3000/api/citations?ownerId=${TEST_USER.id}`, {
                    method: 'POST',
                    body: { FactTable: 'People', FactId: person.Id, SourceId: source.Id },
                })
            );
            expect(res.status).toBe(403);
        });
    });
});
