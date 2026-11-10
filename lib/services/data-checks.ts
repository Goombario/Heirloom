import { resolveTreeScope, type TreeScope } from '@/lib/db/queries/trees';
import {
    getDataCheckInput, listDataCheckConfirmations, upsertDataCheckConfirmation, deleteDataCheckConfirmation,
    type ConfirmedFact, type DataCheckConfirmationRow, type DataCheckPersonName,
} from '@/lib/db/queries/data-checks';
import { runDataChecks } from '@/lib/data-checks/engine';
import { neighbourhood } from '@/lib/data-checks/preview';
import { RULE_KIND, type DataCheckInput, type DataCheckProblem, type DataCheckRuleId } from '@/lib/data-checks/rules';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import type { DataCheckEntry, DataChecksResult, DataChecksSummary } from '@/lib/data/types';

export interface DataChecksScopeParams {
    requestedTreeId: number | null;
    requestedOwnerId: number | null;
    currentUserId: number;
}

/** A confirmation's reason is a sentence or two, not a document. */
const REASON_MAX = 1000;

function resolve(params: DataChecksScopeParams): Promise<TreeScope> {
    return resolveTreeScope({ treeId: params.requestedTreeId, ownerId: params.requestedOwnerId }, params.currentUserId);
}

/** Viewers can see Confirmed but not change it (#830). Contributors can confirm: that's a write. */
function assertCanConfirm(scope: TreeScope): void {
    if (scope.permission === 'view') throw new AccessError('You only have view permission for this tree');
}

/**
 * Reopening deletes a confirmation, often someone else's, with its reason, so
 * it sits on the delete rung: contributors can't, as for every other delete.
 */
function assertCanReopen(scope: TreeScope): void {
    if (scope.permission === 'view' || scope.permission === 'contribute') {
        throw new AccessError('You do not have permission to reopen checks in this tree');
    }
}

function factsOf(problem: DataCheckProblem): ConfirmedFact[] {
    return problem.facts.map((f) => ({ key: f.key, date: f.date })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function sameFacts(a: ConfirmedFact[], b: ConfirmedFact[]): boolean {
    const sorted = [...a].sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    return sorted.length === b.length && sorted.every((f, i) => f.key === b[i].key && f.date === b[i].date);
}

/**
 * A confirmation applies only while the rule, threshold, involved dates and
 * their stored strings all still match the live problem (#786). Edit any of
 * them and the problem is back to To check; the stale row is simply ignored.
 */
function applies(row: DataCheckConfirmationRow, problem: DataCheckProblem): boolean {
    return problem.kind === 'unlikely'
        && row.Rule === problem.rule
        && row.PersonId === problem.personId
        && (row.Threshold ?? null) === problem.threshold
        && sameFacts(row.Facts ?? [], factsOf(problem));
}

/** A TIMESTAMPTZ as an ISO string: pg over HTTP serializes it, but PGlite hands back a Date. */
function isoTime(value: string | Date): string {
    return new Date(value).toISOString();
}

/** `${rule}:${personId}` → its parts, or a 400 for anything else. */
function parseProblemId(problemId: unknown): { rule: DataCheckRuleId; personId: number } {
    const m = typeof problemId === 'string' ? problemId.match(/^([a-z_]+):(\d+)$/) : null;
    if (!m || !Object.hasOwn(RULE_KIND, m[1])) throw new ValidationError('problemId must be "<rule>:<personId>"');
    return { rule: m[1] as DataCheckRuleId, personId: Number(m[2]) };
}

/** Narrow the list to one person's or one family's problems (#833). */
export interface DataChecksFilterParams {
    /** Problems with a date to fix on this person's own timeline: their birth, death or events. */
    personId?: number | null;
    /** Problems that involve this family: its hero flag. */
    familyId?: number | null;
}

function matchesFilter(p: DataCheckProblem, { personId, familyId }: DataChecksFilterParams): boolean {
    if (personId != null && !p.facts.some((f) => f.personId === personId && p.editable.includes(f.key))) return false;
    if (familyId != null && !p.familyIds.includes(familyId)) return false;
    return true;
}

/** A whole tree's checks: what every list, filtered or not, is cut from. */
export interface DataChecksSnapshot {
    input: DataCheckInput;
    names: DataCheckPersonName[];
    confirmations: Array<DataCheckConfirmationRow & { ConfirmedByName: string | null }>;
    problems: DataCheckProblem[];
}

/** Loads a tree's snapshot. The local build passes one that reuses it until the next write (#1269). */
export type DataChecksLoader = (treeId: number) => Promise<DataChecksSnapshot>;

/** Read the tree's dates and confirmations and run every rule once. */
export async function loadDataChecks(treeId: number): Promise<DataChecksSnapshot> {
    // Together, for the same reason as the reads inside getDataCheckInput (#852).
    const [{ names, ...input }, confirmations] = await Promise.all([
        getDataCheckInput(treeId),
        listDataCheckConfirmations(treeId),
    ]);
    return { input, names, confirmations, problems: runDataChecks(input) };
}

/**
 * GET /api/data-checks logic (#828): any reader of the tree may see its
 * problems. They are computed on demand from the tree's current dates and
 * never stored (#786); only confirmations are (#830).
 */
export async function listDataChecksService(
    params: DataChecksScopeParams & DataChecksFilterParams,
    load: DataChecksLoader = loadDataChecks,
): Promise<DataChecksResult> {
    const scope = await resolve(params);
    const { input, names, confirmations, problems: all } = await load(scope.treeId);
    return resultFor(input, names, entriesOf(all.filter((p) => matchesFilter(p, params)), confirmations));
}

/** Each problem with the confirmation that still applies to it, if any. */
function entriesOf(problems: DataCheckProblem[], confirmations: DataChecksSnapshot['confirmations']): DataCheckEntry[] {
    const byProblem = new Map(confirmations.map((c) => [`${c.Rule}:${c.PersonId}`, c]));
    return problems.map((p) => {
        const row = byProblem.get(p.id);
        return {
            ...p,
            confirmation: row && applies(row, p)
                ? { reason: row.Reason, confirmedBy: row.ConfirmedBy, confirmedByName: row.ConfirmedByName, confirmedAt: isoTime(row.ConfirmedAt) }
                : null,
        };
    });
}

/** The entries with the people and families they name, and no one else. */
function resultFor(input: DataCheckInput, names: DataCheckPersonName[], problems: DataCheckEntry[]): DataChecksResult {
    const involved = new Set<number>();
    const involvedFamilies = new Set<number>();
    for (const p of problems) {
        involved.add(p.personId);
        for (const id of p.relatedPersonIds) involved.add(id);
        for (const id of p.familyIds) involvedFamilies.add(id);
    }
    // A family filter names the family by its partners (#831), so they're listed too.
    const families = input.families
        .filter((f) => involvedFamilies.has(f.Id))
        .map(({ Id, Partner1Id, Partner2Id }) => ({ Id, Partner1Id, Partner2Id }));
    for (const f of families) {
        if (f.Partner1Id != null) involved.add(f.Partner1Id);
        if (f.Partner2Id != null) involved.add(f.Partner2Id);
    }
    return { problems, people: names.filter((n) => involved.has(n.Id)), families };
}

/** How many entries the home card shows unless asked otherwise, and the most it will send. */
const SUMMARY_DEFAULT = 3;
const SUMMARY_MAX = 25;

/**
 * GET /api/data-checks/summary logic (#1270): how many problems are still to
 * check, and the first few in the list's order. Home shows a count and three
 * rows; the whole list is most of a megabyte on a large tree.
 */
export async function summarizeDataChecksService(
    params: DataChecksScopeParams & { limit?: number | null },
    load: DataChecksLoader = loadDataChecks,
): Promise<DataChecksSummary> {
    const scope = await resolve(params);
    const limit = Math.min(Math.max(Math.trunc(params.limit ?? SUMMARY_DEFAULT), 0), SUMMARY_MAX);
    const { input, names, confirmations, problems } = await load(scope.treeId);
    const open = entriesOf(problems, confirmations).filter((p) => p.confirmation == null);
    return { openCount: open.length, top: resultFor(input, names, open.slice(0, limit)) };
}

/**
 * POST /api/data-checks/confirmations logic (#830): confirm an unlikely problem
 * as correct, with a reason. Impossible problems can only be fixed. The
 * problem is re-checked against the tree's current dates, so what's stored is
 * exactly what the confirmation was made against.
 */
export async function confirmDataCheckService(params: DataChecksScopeParams & { problemId: unknown; reason: unknown }): Promise<DataCheckEntry> {
    const scope = await resolve(params);
    assertCanConfirm(scope);
    const { rule, personId } = parseProblemId(params.problemId);
    const reason = typeof params.reason === 'string' ? params.reason.trim() : '';
    if (!reason) throw new ValidationError('A reason is required');
    if (reason.length > REASON_MAX) throw new ValidationError(`The reason must be ${REASON_MAX} characters or fewer`);
    if (RULE_KIND[rule] !== 'unlikely') throw new ValidationError('Only unlikely checks can be confirmed; impossible ones can only be fixed');

    const { names: _names, ...input } = await getDataCheckInput(scope.treeId);
    const problem = runDataChecks(input).find((p) => p.id === `${rule}:${personId}`);
    if (!problem) throw new NotFoundError('That check no longer finds a problem');

    const row = await upsertDataCheckConfirmation({
        treeId: scope.treeId,
        ownerId: scope.ownerId,
        userId: params.currentUserId,
        personId,
        rule,
        threshold: problem.threshold,
        facts: factsOf(problem),
        reason,
    });
    return {
        ...problem,
        confirmation: { reason: row.Reason, confirmedBy: row.ConfirmedBy, confirmedByName: null, confirmedAt: isoTime(row.ConfirmedAt) },
    };
}

/** DELETE /api/data-checks/confirmations logic (#830): reopen a confirmed problem. */
export async function reopenDataCheckService(params: DataChecksScopeParams & { problemId: unknown }): Promise<void> {
    const scope = await resolve(params);
    assertCanReopen(scope);
    const { rule, personId } = parseProblemId(params.problemId);
    const deleted = await deleteDataCheckConfirmation({
        treeId: scope.treeId, ownerId: scope.ownerId, userId: params.currentUserId, personId, rule,
    });
    if (!deleted) throw new NotFoundError('That check is not confirmed');
}

/**
 * GET /api/data-checks/neighbourhood logic (#832): the dates one person's
 * problems depend on, so the detail's date editor can say, as you type, whether
 * a new date clears the problem. Any reader of the tree may see it.
 */
export async function dataCheckNeighbourhoodService(
    params: DataChecksScopeParams & { personId: number | null },
    load?: DataChecksLoader,
): Promise<DataCheckInput> {
    const scope = await resolve(params);
    if (params.personId == null) throw new ValidationError('personId is required');
    const input = load ? (await load(scope.treeId)).input : (({ names: _names, ...rest }) => rest)(await getDataCheckInput(scope.treeId));
    if (!input.people.some((p) => p.Id === params.personId)) throw new NotFoundError('Person not found');
    return neighbourhood(input, params.personId);
}
