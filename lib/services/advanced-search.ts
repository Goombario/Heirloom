import { resolveTreeScope } from '@/lib/db/queries/trees';
import {
    loadSearchCases, loadSearchCitations, loadSearchEvents, loadSearchFamilies, loadSearchNames,
    loadSearchNotes, loadSearchPeople, loadSearchPlaces,
} from '@/lib/db/queries/advanced-search';
import { deleteSavedSearch, insertSavedSearch, listSavedSearches } from '@/lib/db/queries/saved-searches';
import { evaluatePeopleSearch, neededSlices, type PeopleSearchIndex, type PeopleSearchResult } from '@/lib/search/evaluate-people';
import { conditionCount, normalizeQuery, type SearchQuery } from '@/lib/search/people-query';
import { NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import { listDataChecksService, type DataChecksLoader } from './data-checks';

/**
 * Advanced search on the People list (#247, ADR 0054). Any reader of a tree may
 * search it and keep their own saved searches; results are what that reader can
 * see, so a search shared by link shows each member their own tree's matches.
 */

export interface SearchScopeParams {
    requestedTreeId: number | null;
    requestedOwnerId: number | null;
    currentUserId: number;
}

type Slice = keyof PeopleSearchIndex;

/** Loads one tree's search index, with at least the given slices. The local build caches it until a write. */
export type PeopleSearchIndexLoader = (treeId: number, slices: Set<Slice>, scope: SearchScopeParams) => Promise<PeopleSearchIndex>;

/** Reads the slices a query needs, together. */
export async function loadPeopleSearchIndex(
    treeId: number,
    slices: Set<Slice>,
    scope: SearchScopeParams,
    dataChecks?: DataChecksLoader,
): Promise<PeopleSearchIndex> {
    const want = (s: Slice) => slices.has(s);
    const [people, names, fam, events, places, citations, cases, notes, problems] = await Promise.all([
        loadSearchPeople(treeId),
        want('names') ? loadSearchNames(treeId) : null,
        want('families') || want('children') ? loadSearchFamilies(treeId) : null,
        want('events') ? loadSearchEvents(treeId) : null,
        want('places') ? loadSearchPlaces(treeId) : null,
        want('citations') ? loadSearchCitations(treeId) : null,
        want('cases') ? loadSearchCases(treeId) : null,
        want('notes') ? loadSearchNotes(treeId) : null,
        want('problems') ? listDataChecksService({ ...scope, requestedTreeId: treeId }, dataChecks) : null,
    ]);
    const index: PeopleSearchIndex = { people };
    if (names) {
        index.names = new Map();
        for (const n of names) {
            const list = index.names.get(n.PersonId);
            if (list) list.push(n.Name); else index.names.set(n.PersonId, [n.Name]);
        }
    }
    if (fam) { index.families = fam.families; index.children = fam.children; }
    if (events) index.events = events;
    if (places) index.places = places;
    if (citations) index.citations = citations;
    if (cases) index.cases = cases;
    if (notes) index.notes = notes;
    if (problems) {
        // Only problems still to check: a confirmed one isn't an issue any more.
        index.problems = new Map();
        for (const p of problems.problems) {
            if (p.confirmation) continue;
            const rules = index.problems.get(p.personId);
            if (rules) rules.add(p.rule); else index.problems.set(p.personId, new Set([p.rule]));
        }
    }
    return index;
}

const defaultLoader: PeopleSearchIndexLoader = (treeId, slices, scope) => loadPeopleSearchIndex(treeId, slices, scope);

export interface PeopleSearchResponse extends PeopleSearchResult {
    count: number;
}

/** POST /api/people/search logic: the people a query matches. `explain` adds the empty state's counts. */
export async function searchPeopleService(
    params: SearchScopeParams & { query: unknown; explain?: boolean },
    load: PeopleSearchIndexLoader = defaultLoader,
): Promise<PeopleSearchResponse> {
    const scope = await resolveTreeScope({ treeId: params.requestedTreeId, ownerId: params.requestedOwnerId }, params.currentUserId);
    const query = normalizeQuery(params.query);
    const index = await load(scope.treeId, neededSlices(query), params);
    const result = evaluatePeopleSearch(index, query, params.explain === true);
    return { ...result, count: result.ids?.length ?? index.people.length };
}

export interface SavedSearch {
    id: number;
    name: string;
    query: SearchQuery;
    /** How many people it matches now. */
    count: number;
}

const PAGE = 'people';
const NAME_MAX = 120;
/** Each listing re-runs every saved search, so a member keeps a bounded number per tree. */
const SAVED_MAX = 50;

/** GET /api/saved-searches logic: the member's own saved searches, each with a live count. */
export async function listSavedSearchesService(params: SearchScopeParams, load: PeopleSearchIndexLoader = defaultLoader): Promise<SavedSearch[]> {
    const scope = await resolveTreeScope({ treeId: params.requestedTreeId, ownerId: params.requestedOwnerId }, params.currentUserId);
    const rows = await listSavedSearches(params.currentUserId, scope.treeId, PAGE);
    if (rows.length === 0) return [];
    const queries = rows.map((r) => {
        try { return normalizeQuery(JSON.parse(r.Query)); } catch { return normalizeQuery(null); }
    });
    const slices = new Set<Slice>();
    for (const q of queries) for (const s of neededSlices(q)) slices.add(s);
    const index = await load(scope.treeId, slices, params);
    return rows.map((r, i) => ({
        id: r.Id,
        name: r.Name,
        query: queries[i],
        count: evaluatePeopleSearch(index, queries[i]).ids?.length ?? index.people.length,
    }));
}

/** POST /api/saved-searches logic: saving asks only for a name (#247 lock). */
export async function saveSearchService(params: SearchScopeParams & { name: unknown; query: unknown }): Promise<{ id: number }> {
    const scope = await resolveTreeScope({ treeId: params.requestedTreeId, ownerId: params.requestedOwnerId }, params.currentUserId);
    const name = typeof params.name === 'string' ? params.name.trim() : '';
    if (!name) throw new ValidationError('name is required');
    if (name.length > NAME_MAX) throw new ValidationError(`name must be ${NAME_MAX} characters or fewer`);
    const query = normalizeQuery(params.query);
    if (conditionCount(query) === 0) throw new ValidationError('query has no conditions');
    if ((await listSavedSearches(params.currentUserId, scope.treeId, PAGE)).length >= SAVED_MAX) {
        throw new ValidationError(`a member can keep up to ${SAVED_MAX} saved searches in a tree`);
    }
    const row = await insertSavedSearch(params.currentUserId, scope.treeId, PAGE, name, JSON.stringify(query));
    return { id: row.Id };
}

/** DELETE /api/saved-searches/[id] logic: a member deletes only their own. */
export async function deleteSavedSearchService(params: SearchScopeParams & { id: number }): Promise<void> {
    const scope = await resolveTreeScope({ treeId: params.requestedTreeId, ownerId: params.requestedOwnerId }, params.currentUserId);
    if (!(await deleteSavedSearch(params.currentUserId, scope.treeId, params.id))) throw new NotFoundError('Saved search not found');
}
