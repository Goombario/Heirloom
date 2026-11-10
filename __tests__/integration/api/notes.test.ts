import { describe, it, expect, afterEach, vi } from 'vitest';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { GET as LIST_NOTES, POST as CREATE_NOTE } from '@/app/api/notes/route';
import { PUT as UPDATE_NOTE, DELETE as DELETE_NOTE, PATCH as SET_PRIMARY_NOTE } from '@/app/api/notes/[id]/route';
import { POST as CREATE_SOURCE } from '@/app/api/sources/route';
import { POST as CREATE_FAMILY } from '@/app/api/families/route';
import { POST as POST_SHARING } from '@/app/api/sharing/route';
import { createRequest, parseResponse, TEST_USER, TEST_USER_2 } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as CREATE_EVENT } from '@/app/api/events/route';
import { GET as GET_PERSON } from '@/app/api/people/[id]/route';
import { POST as CREATE_TREE } from '@/app/api/trees/route';
import { createNoteForOwnerService, listNotesForOwnerService } from '@/lib/services/notes';
import { assertOwnerInTree } from '@/lib/services/owner-links';
import { NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import { resolveDefaultTree } from '@/lib/db/queries/trees';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface NoteShape { Id: number; Text: string; OwnerId: number }

describeIf('API /api/notes', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    async function createSource(): Promise<{ Id: number }> {
        const res = await CREATE_SOURCE(createRequest('http://localhost:3000/api/sources', {
            method: 'POST', body: { Title: 'Parish register', Type: 'Church' },
        }));
        return (await parseResponse<{ source: { Id: number } }>(res)).source;
    }

    async function createFamily(): Promise<{ Id: number }> {
        const res = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
            method: 'POST', body: { MarriageDate: '1900' },
        }));
        return (await parseResponse<{ family: { Id: number } }>(res)).family;
    }

    async function createPerson(): Promise<{ Id: number }> {
        const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST', body: { FirstName: 'Alice', LastName: 'Owner' },
        }));
        return (await parseResponse<{ person: { Id: number } }>(res)).person;
    }

    async function createEvent(personId: number): Promise<{ Id: number }> {
        const res = await CREATE_EVENT(createRequest('http://localhost:3000/api/events', {
            method: 'POST', body: { Type: 'RESI', Date: '1911', Place: 'Deptford', PersonId: personId },
        }));
        expect(res.status).toBe(201);
        return (await parseResponse<{ event: { Id: number } }>(res)).event;
    }

    async function createTree(name: string): Promise<{ Id: number }> {
        const res = await CREATE_TREE(createRequest('http://localhost:3000/api/trees', {
            method: 'POST', body: { name },
        }));
        expect(res.status).toBe(201);
        return (await parseResponse<{ tree: { Id: number } }>(res)).tree;
    }

    function listUrl(ownerTable: string, recordId: number): string {
        return `http://localhost:3000/api/notes?ownerTable=${ownerTable}&recordId=${recordId}`;
    }

    it('marks a note written through the API as added in the app, so it never stands in as a biography (#902)', async () => {
        const person = await createPerson();
        const createRes = await CREATE_NOTE(createRequest('http://localhost:3000/api/notes', {
            method: 'POST', body: { ownerTable: 'People', recordId: person.Id, text: 'Typed in the rail' },
        }));
        expect(createRes.status).toBe(201);
        expect((await parseResponse<{ note: NoteShape & { AddedInApp?: number } }>(createRes)).note.AddedInApp).toBe(1);

        const { notes } = await parseResponse<{ notes: Array<NoteShape & { AddedInApp?: number; IsPrimary?: number }> }>(
            await LIST_NOTES(createRequest(listUrl('People', person.Id))),
        );
        expect(notes).toEqual([expect.objectContaining({ Text: 'Typed in the rail', AddedInApp: 1, IsPrimary: 0 })]);
    });

    it('creates, lists, and deletes a note on a source', async () => {
        const source = await createSource();

        const createRes = await CREATE_NOTE(createRequest('http://localhost:3000/api/notes', {
            method: 'POST', body: { ownerTable: 'Sources', recordId: source.Id, text: '  Fragile — handle with care  ' },
        }));
        expect(createRes.status).toBe(201);
        const { note } = await parseResponse<{ note: NoteShape }>(createRes);
        expect(note.Text).toBe('Fragile — handle with care'); // trimmed

        const listRes = await LIST_NOTES(createRequest(listUrl('Sources', source.Id)));
        const { notes } = await parseResponse<{ notes: NoteShape[] }>(listRes);
        expect(notes.map((n) => n.Text)).toEqual(['Fragile — handle with care']);

        const delRes = await DELETE_NOTE(
            createRequest(`http://localhost:3000/api/notes/${note.Id}?ownerTable=Sources&recordId=${source.Id}`, { method: 'DELETE' }),
            { params: Promise.resolve({ id: String(note.Id) }) },
        );
        expect(delRes.status).toBe(200);
        expect((await parseResponse<{ auditIds: number[] }>(delRes)).auditIds).toHaveLength(1);

        const afterRes = await LIST_NOTES(createRequest(listUrl('Sources', source.Id)));
        expect((await parseResponse<{ notes: NoteShape[] }>(afterRes)).notes).toHaveLength(0);
    });

    it('edits a note\'s text in place (§1.4)', async () => {
        const source = await createSource();
        const createRes = await CREATE_NOTE(createRequest('http://localhost:3000/api/notes', {
            method: 'POST', body: { ownerTable: 'Sources', recordId: source.Id, text: 'Original text' },
        }));
        const { note } = await parseResponse<{ note: NoteShape }>(createRes);

        const putRes = await UPDATE_NOTE(
            createRequest(`http://localhost:3000/api/notes/${note.Id}?ownerTable=Sources&recordId=${source.Id}`, {
                method: 'PUT', body: { text: '  Corrected text  ' },
            }),
            { params: Promise.resolve({ id: String(note.Id) }) },
        );
        expect(putRes.status).toBe(200);
        expect((await parseResponse<{ note: NoteShape }>(putRes)).note.Text).toBe('Corrected text'); // trimmed

        const listRes = await LIST_NOTES(createRequest(listUrl('Sources', source.Id)));
        expect((await parseResponse<{ notes: NoteShape[] }>(listRes)).notes.map((n) => n.Text)).toEqual(['Corrected text']);
    });

    it('rejects editing a note to empty text with 400', async () => {
        const source = await createSource();
        const createRes = await CREATE_NOTE(createRequest('http://localhost:3000/api/notes', {
            method: 'POST', body: { ownerTable: 'Sources', recordId: source.Id, text: 'Keep me' },
        }));
        const { note } = await parseResponse<{ note: NoteShape }>(createRes);
        const putRes = await UPDATE_NOTE(
            createRequest(`http://localhost:3000/api/notes/${note.Id}?ownerTable=Sources&recordId=${source.Id}`, {
                method: 'PUT', body: { text: '   ' },
            }),
            { params: Promise.resolve({ id: String(note.Id) }) },
        );
        expect(putRes.status).toBe(400);
    });

    it('returns 404 editing a note not linked to the given owner', async () => {
        const source = await createSource();
        const createRes = await CREATE_NOTE(createRequest('http://localhost:3000/api/notes', {
            method: 'POST', body: { ownerTable: 'Sources', recordId: source.Id, text: 'Note text' },
        }));
        const { note } = await parseResponse<{ note: NoteShape }>(createRes);
        // Same note id, wrong owner record → not reachable → 404.
        const putRes = await UPDATE_NOTE(
            createRequest(`http://localhost:3000/api/notes/${note.Id}?ownerTable=Sources&recordId=888888`, {
                method: 'PUT', body: { text: 'hijack' },
            }),
            { params: Promise.resolve({ id: String(note.Id) }) },
        );
        expect(putRes.status).toBe(404);
    });

    it('attaches a note to a family', async () => {
        const family = await createFamily();
        const res = await CREATE_NOTE(createRequest('http://localhost:3000/api/notes', {
            method: 'POST', body: { ownerTable: 'Families', recordId: family.Id, text: 'They eloped' },
        }));
        expect(res.status).toBe(201);
        const listRes = await LIST_NOTES(createRequest(listUrl('Families', family.Id)));
        expect((await parseResponse<{ notes: NoteShape[] }>(listRes)).notes[0].Text).toBe('They eloped');
    });

    it('rejects an empty note with 400', async () => {
        const source = await createSource();
        const res = await CREATE_NOTE(createRequest('http://localhost:3000/api/notes', {
            method: 'POST', body: { ownerTable: 'Sources', recordId: source.Id, text: '   ' },
        }));
        expect(res.status).toBe(400);
    });

    it('rejects an invalid ownerTable with 400', async () => {
        const res = await CREATE_NOTE(createRequest('http://localhost:3000/api/notes', {
            method: 'POST', body: { ownerTable: 'Robert"); DROP', recordId: 1, text: 'x' },
        }));
        expect(res.status).toBe(400);
    });

    it('IDOR: rejects a note for a record not in the tree with 404', async () => {
        const res = await CREATE_NOTE(createRequest('http://localhost:3000/api/notes', {
            method: 'POST', body: { ownerTable: 'Sources', recordId: 999999, text: 'x' },
        }));
        expect(res.status).toBe(404);
    });

    it('view-only collaborator gets 403 creating a note', async () => {
        const source = await createSource();
        await POST_SHARING(createRequest('http://localhost:3000/api/sharing', {
            method: 'POST', body: { email: TEST_USER_2.email, permission: 'view' },
        }));
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(TEST_USER_2);
        const res = await CREATE_NOTE(createRequest(`http://localhost:3000/api/notes?ownerId=${TEST_USER.id}`, {
            method: 'POST', body: { ownerTable: 'Sources', recordId: source.Id, text: 'x' },
        }));
        expect(res.status).toBe(403);
    });

    // ADR 0010/0012 — the preferred-note flag. It lives on NoteLink, so it is
    // per-owner, and at most one per owner (idx_notelink_one_primary).
    function primaryUrl(ownerTable: string, recordId: number): string {
        return `http://localhost:3000/api/notes/0?ownerTable=${ownerTable}&recordId=${recordId}`;
    }

    async function addNote(sourceId: number, text: string): Promise<NoteShape> {
        const res = await CREATE_NOTE(createRequest('http://localhost:3000/api/notes', {
            method: 'POST', body: { ownerTable: 'Sources', recordId: sourceId, text },
        }));
        return (await parseResponse<{ note: NoteShape }>(res)).note;
    }

    async function listNotes(sourceId: number): Promise<Array<NoteShape & { IsPrimary?: number }>> {
        const res = await LIST_NOTES(createRequest(listUrl('Sources', sourceId)));
        return (await parseResponse<{ notes: Array<NoteShape & { IsPrimary?: number }> }>(res)).notes;
    }

    it('marks a note as the owner preferred one', async () => {
        const source = await createSource();
        const note = await addNote(source.Id, 'first');
        const res = await SET_PRIMARY_NOTE(
            createRequest(primaryUrl('Sources', source.Id), { method: 'PATCH', body: { isPrimary: true } }),
            { params: Promise.resolve({ id: String(note.Id) }) },
        );
        expect(res.status).toBe(200);
        expect((await listNotes(source.Id)).find((n) => n.Id === note.Id)?.IsPrimary).toBe(1);
    });

    it('moves the preferred flag rather than rejecting a second one', async () => {
        const source = await createSource();
        const a = await addNote(source.Id, 'a');
        const b = await addNote(source.Id, 'b');
        for (const id of [a.Id, b.Id]) {
            const res = await SET_PRIMARY_NOTE(
                createRequest(primaryUrl('Sources', source.Id), { method: 'PATCH', body: { isPrimary: true } }),
                { params: Promise.resolve({ id: String(id) }) },
            );
            expect(res.status).toBe(200);
        }
        const notes = await listNotes(source.Id);
        expect(notes.filter((n) => n.IsPrimary === 1).map((n) => n.Id)).toEqual([b.Id]);
    });

    it('does NOT clear the existing preferred note when the target is unrelated', async () => {
        // Demoting before validating would silently drop the owner's preferred
        // note on a request that then 404s — the caller is told nothing happened.
        const source = await createSource();
        const kept = await addNote(source.Id, 'kept');
        await SET_PRIMARY_NOTE(
            createRequest(primaryUrl('Sources', source.Id), { method: 'PATCH', body: { isPrimary: true } }),
            { params: Promise.resolve({ id: String(kept.Id) }) },
        );

        const other = await createSource();
        const foreign = await addNote(other.Id, 'not this owner');
        const res = await SET_PRIMARY_NOTE(
            createRequest(primaryUrl('Sources', source.Id), { method: 'PATCH', body: { isPrimary: true } }),
            { params: Promise.resolve({ id: String(foreign.Id) }) },
        );
        expect(res.status).toBe(404);
        expect((await listNotes(source.Id)).find((n) => n.Id === kept.Id)?.IsPrimary).toBe(1);
    });

    it('clears the preferred flag with isPrimary false', async () => {
        const source = await createSource();
        const note = await addNote(source.Id, 'only');
        const url = primaryUrl('Sources', source.Id);
        const p = { params: Promise.resolve({ id: String(note.Id) }) };
        await SET_PRIMARY_NOTE(createRequest(url, { method: 'PATCH', body: { isPrimary: true } }), p);
        const res = await SET_PRIMARY_NOTE(
            createRequest(url, { method: 'PATCH', body: { isPrimary: false } }),
            { params: Promise.resolve({ id: String(note.Id) }) },
        );
        expect(res.status).toBe(200);
        expect((await listNotes(source.Id)).find((n) => n.Id === note.Id)?.IsPrimary).toBe(0);
    });

    it('returns 400 without a boolean isPrimary', async () => {
        const source = await createSource();
        const note = await addNote(source.Id, 'x');
        const res = await SET_PRIMARY_NOTE(
            createRequest(primaryUrl('Sources', source.Id), { method: 'PATCH', body: {} }),
            { params: Promise.resolve({ id: String(note.Id) }) },
        );
        expect(res.status).toBe(400);
    });

    it('returns 401 when unauthenticated', async () => {
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
        const res = await CREATE_NOTE(createRequest('http://localhost:3000/api/notes', {
            method: 'POST', body: { ownerTable: 'Sources', recordId: 1, text: 'x' },
        }));
        expect(res.status).toBe(401);
    });

    it('creates a fact-scoped note and returns the scope on read', async () => {
        const person = await createPerson();
        const treeId = await resolveDefaultTree(TEST_USER.id);
        const created = await createNoteForOwnerService({
            ownerTable: 'People', ownerId: person.Id, text: 'Baptism recorded a day late.',
            ownerFact: 'Birth',
            requestedTreeId: treeId, requestedOwnerId: null, currentUserId: TEST_USER.id,
        });
        expect(created.OwnerFact).toBe('Birth');

        const listed = await listNotesForOwnerService({
            ownerTable: 'People', ownerId: person.Id,
            requestedTreeId: treeId, requestedOwnerId: null, currentUserId: TEST_USER.id,
        });
        expect(listed.find((n) => n.Id === created.Id)?.OwnerFact).toBe('Birth');
    });

    // Event-scoped notes (#545). GEDCOM import writes NoteLink(OwnerTable='Events')
    // rows, so they must be readable back through the same owner path every UI
    // mount uses — and must not be reachable from another tree.
    it('lists a note attached to an event', async () => {
        const person = await createPerson();
        const event = await createEvent(person.Id);
        const treeId = await resolveDefaultTree(TEST_USER.id);

        const created = await createNoteForOwnerService({
            ownerTable: 'Events', ownerId: event.Id, text: 'Recorded in the parish register.',
            requestedTreeId: treeId, requestedOwnerId: null, currentUserId: TEST_USER.id,
        });

        const listed = await listNotesForOwnerService({
            ownerTable: 'Events', ownerId: event.Id,
            requestedTreeId: treeId, requestedOwnerId: null, currentUserId: TEST_USER.id,
        });
        expect(listed.map((n) => n.Id)).toContain(created.Id);
        expect(listed.find((n) => n.Id === created.Id)?.Text).toBe('Recorded in the parish register.');
    });

    it('IDOR: an event from another tree is not a valid note owner', async () => {
        const person = await createPerson();
        const event = await createEvent(person.Id);
        const otherTree = await createTree('Tree B (event notes)');

        // A real cross-tree attempt: the caller owns both trees, but the event
        // belongs to the default one, so scoping the write to tree B must fail.
        await expect(assertOwnerInTree('Events', event.Id, otherTree.Id)).rejects.toThrow(NotFoundError);

        await expect(createNoteForOwnerService({
            ownerTable: 'Events', ownerId: event.Id, text: 'should never be linked',
            requestedTreeId: otherTree.Id, requestedOwnerId: null, currentUserId: TEST_USER.id,
        })).rejects.toThrow(NotFoundError);

        // And a note that DOES exist in the default tree stays invisible from tree B.
        const treeId = await resolveDefaultTree(TEST_USER.id);
        await createNoteForOwnerService({
            ownerTable: 'Events', ownerId: event.Id, text: 'tree A only',
            requestedTreeId: treeId, requestedOwnerId: null, currentUserId: TEST_USER.id,
        });
        const fromOtherTree = await listNotesForOwnerService({
            ownerTable: 'Events', ownerId: event.Id,
            requestedTreeId: otherTree.Id, requestedOwnerId: null, currentUserId: TEST_USER.id,
        });
        expect(fromOtherTree).toHaveLength(0);
    });

    // The life-events timeline decides which rows offer a "show notes" affordance
    // from counts that ride in with the person payload — one batched query, never
    // one request per event row. A view-only reader depends on this: the rail
    // itself only loads once they open a row.
    it('carries each event\'s note count on the person payload', async () => {
        const person = await createPerson();
        const withNotes = await createEvent(person.Id);
        const withoutNotes = await createEvent(person.Id);
        const treeId = await resolveDefaultTree(TEST_USER.id);
        for (const text of ['First note', 'Second note']) {
            await createNoteForOwnerService({
                ownerTable: 'Events', ownerId: withNotes.Id, text,
                requestedTreeId: treeId, requestedOwnerId: null, currentUserId: TEST_USER.id,
            });
        }

        const res = await GET_PERSON(
            createRequest(`http://localhost:3000/api/people/${person.Id}`),
            { params: Promise.resolve({ id: String(person.Id) }) },
        );
        const { person: loaded } = await parseResponse<{ person: { events: { Id: number; noteCount?: number }[] } }>(res);
        const byId = new Map(loaded.events.map((e) => [e.Id, e.noteCount]));
        expect(byId.get(withNotes.Id)).toBe(2);
        // Present and zero, not absent — the UI reads it directly.
        expect(byId.get(withoutNotes.Id)).toBe(0);
    });

    it('rejects an ownerFact outside the vocabulary', async () => {
        const person = await createPerson();
        const treeId = await resolveDefaultTree(TEST_USER.id);
        await expect(createNoteForOwnerService({
            ownerTable: 'People', ownerId: person.Id, text: 'x',
            ownerFact: 'Bogus' as never,
            requestedTreeId: treeId, requestedOwnerId: null, currentUserId: TEST_USER.id,
        })).rejects.toThrow(ValidationError);
    });
});
