import { describe, it, expect, afterEach } from 'vitest';
import { GET } from '@/app/api/tree/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { POST as CREATE_FAMILY } from '@/app/api/families/route';
import { POST as ADD_CHILD } from '@/app/api/families/[id]/children/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface TreeNodeShape { id: number; name: string; children?: TreeNodeShape[] }

interface FocusResponse {
    tree: TreeNodeShape;
    currentMode: 'descendants' | 'ancestors' | 'focus';
    suggestedMode: 'descendants' | 'ancestors' | 'focus';
    focusTrees?:
        | { stage: 'A'; center: TreeNodeShape; focusPersonId: number }
        | {
            stage: 'D';
            center: TreeNodeShape;
            left: TreeNodeShape | null;
            right: TreeNodeShape | null;
            leftParentId: number | null;
            rightParentId: number | null;
            focusPersonId: number;
        };
}

describeIf('API /api/tree?mode=focus', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    async function createPerson(firstName: string, lastName: string) {
        const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST',
            body: { FirstName: firstName, LastName: lastName },
        }));
        return (await parseResponse<{ person: { Id: number } }>(res)).person;
    }

    async function linkChild(familyId: number, childId: number) {
        await ADD_CHILD(
            createRequest(`http://localhost:3000/api/families/${familyId}/children`, {
                method: 'POST',
                body: { childId },
            }),
            { params: Promise.resolve({ id: String(familyId) }) },
        );
    }

    async function createFamily(partner1Id: number, partner2Id?: number) {
        const res = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
            method: 'POST',
            body: partner2Id != null ? { Partner1Id: partner1Id, Partner2Id: partner2Id } : { Partner1Id: partner1Id },
        }));
        return (await parseResponse<{ family: { Id: number } }>(res)).family;
    }

    it('returns Stage D when the focus person has at least one parent', async () => {
        const father = await createPerson('Pa', 'X');
        const mother = await createPerson('Ma', 'X');
        const focus = await createPerson('Focus', 'X');
        const parents = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
            method: 'POST',
            body: { Partner1Id: father.Id, Partner2Id: mother.Id },
        }));
        const { family: parentFamily } = await parseResponse<{ family: { Id: number } }>(parents);
        await linkChild(parentFamily.Id, focus.Id);

        const res = await GET(createRequest(`http://localhost:3000/api/tree?id=${focus.Id}&mode=focus`));
        expect(res.status).toBe(200);
        const data = await parseResponse<FocusResponse>(res);
        expect(data.currentMode).toBe('focus');
        expect(data.focusTrees).toBeDefined();
        const focusTrees = data.focusTrees!;
        expect(focusTrees.stage).toBe('D');
        expect(focusTrees.focusPersonId).toBe(focus.Id);
        if (focusTrees.stage === 'D') {
            // leftParentId should resolve to the father; rightParentId to the mother.
            expect(focusTrees.leftParentId).toBe(father.Id);
            expect(focusTrees.rightParentId).toBe(mother.Id);
        }
    });

    it('returns Stage A when the focus person has no parents but has descendants', async () => {
        const focus = await createPerson('Stage', 'A');
        const child = await createPerson('Stage-A', 'Child');
        const fam = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
            method: 'POST',
            body: { Partner1Id: focus.Id },
        }));
        const { family } = await parseResponse<{ family: { Id: number } }>(fam);
        await linkChild(family.Id, child.Id);

        const res = await GET(createRequest(`http://localhost:3000/api/tree?id=${focus.Id}&mode=focus`));
        expect(res.status).toBe(200);
        const data = await parseResponse<FocusResponse>(res);
        expect(data.focusTrees).toBeDefined();
        const focusTrees = data.focusTrees!;
        expect(focusTrees.stage).toBe('A');
        if (focusTrees.stage === 'A') {
            // Stage A only has center.
            expect(focusTrees.center).toBeDefined();
            expect('left' in focusTrees).toBe(false);
        }
    });

    it('suggests focus mode when the person has both parents and descendants', async () => {
        const father = await createPerson('Pa2', 'Y');
        const focus = await createPerson('Focus2', 'Y');
        const child = await createPerson('Child2', 'Y');
        const parents = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
            method: 'POST', body: { Partner1Id: father.Id },
        }));
        const { family: parentFamily } = await parseResponse<{ family: { Id: number } }>(parents);
        await linkChild(parentFamily.Id, focus.Id);

        const own = await CREATE_FAMILY(createRequest('http://localhost:3000/api/families', {
            method: 'POST', body: { Partner1Id: focus.Id },
        }));
        const { family: ownFamily } = await parseResponse<{ family: { Id: number } }>(own);
        await linkChild(ownFamily.Id, child.Id);

        // Without an explicit mode the route should suggest focus.
        const res = await GET(createRequest(`http://localhost:3000/api/tree?id=${focus.Id}`));
        const data = await parseResponse<FocusResponse>(res);
        expect(data.suggestedMode).toBe('focus');
    });

    // REGRESSION GUARD (#347 revert). Focus side-clusters are rooted at the
    // GRANDPARENT and carry that grandparent's full descendant subtree — the
    // parent's siblings (aunts/uncles) and their children (cousins). #347 replaced
    // this with a pure direct-ancestor chain to the oldest ancestor, which rendered
    // focus view as a bare one-node-per-generation string with every collateral
    // relative missing. These assertions fail under that implementation.
    it('roots each side-cluster at the grandparent, capped at 2 ancestor generations', async () => {
        // ggf → gf → father → focus, so a full ancestral walk would reach ggf.
        const ggf = await createPerson('GreatGrand', 'Z');
        const gf = await createPerson('Grand', 'Z');
        const father = await createPerson('Father', 'Z');
        const focus = await createPerson('Focus', 'Z');

        const f1 = await createFamily(ggf.Id); await linkChild(f1.Id, gf.Id);
        const f2 = await createFamily(gf.Id); await linkChild(f2.Id, father.Id);
        const f3 = await createFamily(father.Id); await linkChild(f3.Id, focus.Id);

        const res = await GET(createRequest(`http://localhost:3000/api/tree?id=${focus.Id}&mode=focus`));
        expect(res.status).toBe(200);
        const focusTrees = (await parseResponse<FocusResponse>(res)).focusTrees!;
        expect(focusTrees.stage).toBe('D');
        if (focusTrees.stage !== 'D') return;

        expect(focusTrees.leftParentId).toBe(father.Id);
        const left = focusTrees.left!;
        // Rooted at the GRANDfather — one generation above the focus's parent.
        expect(left.id).toBe(gf.Id);

        const ids = new Set<number>();
        (function walk(n: TreeNodeShape) { ids.add(n.id); n.children?.forEach(walk); })(left);
        // The great-grandfather is ABOVE the 2-generation cap and must not appear.
        expect(ids.has(ggf.Id)).toBe(false);
    });

    it('keeps collateral breadth in focus side-clusters (aunts/uncles and cousins)', async () => {
        // gf → { father, uncle }; uncle → cousin. Focusing on `focus` must surface
        // the uncle (parent's sibling) and the cousin under the paternal cluster.
        const gf = await createPerson('Grand', 'C');
        const father = await createPerson('Father', 'C');
        const uncle = await createPerson('Uncle', 'C');
        const cousin = await createPerson('Cousin', 'C');
        const focus = await createPerson('Focus', 'C');

        const f1 = await createFamily(gf.Id);
        await linkChild(f1.Id, father.Id);
        await linkChild(f1.Id, uncle.Id);
        const f2 = await createFamily(father.Id); await linkChild(f2.Id, focus.Id);
        const f3 = await createFamily(uncle.Id); await linkChild(f3.Id, cousin.Id);

        const res = await GET(createRequest(`http://localhost:3000/api/tree?id=${focus.Id}&mode=focus`));
        expect(res.status).toBe(200);
        const focusTrees = (await parseResponse<FocusResponse>(res)).focusTrees!;
        expect(focusTrees.stage).toBe('D');
        if (focusTrees.stage !== 'D') return;

        const left = focusTrees.left!;
        expect(left.id).toBe(gf.Id);

        const ids = new Set<number>();
        (function walk(n: TreeNodeShape) { ids.add(n.id); n.children?.forEach(walk); })(left);
        // Collateral relatives are the whole point of focus view's side clusters.
        expect(ids.has(uncle.Id)).toBe(true);
        expect(ids.has(cousin.Id)).toBe(true);
        // The direct line is of course still present.
        expect(ids.has(father.Id)).toBe(true);
    });

    // REGRESSION GUARD. A leaf (ancestors, no descendants) defaults to focus and
    // renders a usable Stage-D payload. This used to suggest 'ancestors', and the
    // client's suggested-mode reload path bounced the user out of focus view.
    it('defaults a leaf person (no descendants) to focus mode', async () => {
        const father = await createPerson('LeafPa', 'L');
        const leaf = await createPerson('Leaf', 'L');
        const fam = await createFamily(father.Id);
        await linkChild(fam.Id, leaf.Id);

        // A BARE request (no &mode=) is what actually exercises the leaf branch of
        // the suggestion heuristic — passing &mode=focus would hit the explicit-focus
        // short-circuit and assert nothing about the default.
        const bare = await parseResponse<FocusResponse>(
            await GET(createRequest(`http://localhost:3000/api/tree?id=${leaf.Id}`)),
        );
        expect(bare.suggestedMode).toBe('focus');

        const res = await GET(createRequest(`http://localhost:3000/api/tree?id=${leaf.Id}&mode=focus`));
        expect(res.status).toBe(200);
        const data = await parseResponse<FocusResponse>(res);

        expect(data.currentMode).toBe('focus');
        expect(data.suggestedMode).toBe('focus');

        // …and it yields a usable Stage-D payload rooted at the parent.
        const focusTrees = data.focusTrees!;
        expect(focusTrees.stage).toBe('D');
        if (focusTrees.stage !== 'D') return;
        expect(focusTrees.focusPersonId).toBe(leaf.Id);
        expect(focusTrees.leftParentId).toBe(father.Id);
        expect(focusTrees.center).toBeDefined();
    });

    // REGRESSION GUARD. An EXPLICIT ?mode=focus is never second-guessed by the
    // suggestion heuristics. Exercised on a ROOT person (descendants, no ancestors)
    // — the one case whose heuristic still resolves to something other than focus,
    // so this stays a real assertion rather than one the default satisfies for free.
    it('honours an explicit mode=focus even when the heuristic would suggest otherwise', async () => {
        const rootPerson = await createPerson('RootOnly', 'R');
        const kid = await createPerson('RootKid', 'R');
        const fam = await createFamily(rootPerson.Id);
        await linkChild(fam.Id, kid.Id);

        // Without a mode the heuristic picks 'descendants' for this person…
        const plain = await parseResponse<FocusResponse>(
            await GET(createRequest(`http://localhost:3000/api/tree?id=${rootPerson.Id}`)),
        );
        expect(plain.suggestedMode).toBe('descendants');

        // …but an explicit focus request must survive untouched.
        const res = await GET(createRequest(`http://localhost:3000/api/tree?id=${rootPerson.Id}&mode=focus`));
        expect(res.status).toBe(200);
        const data = await parseResponse<FocusResponse>(res);
        expect(data.currentMode).toBe('focus');
        expect(data.suggestedMode).toBe('focus');
    });
});
