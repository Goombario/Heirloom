import { MEDIA_OWNER_TABLES, isMediaOwnerFactFor, isMediaOwnerTable, type MediaOwnerFact, type MediaOwnerTable } from '@/lib/db/fact-tables';
import { caseExistsInTree } from '@/lib/db/queries/cases';
import { ownerExistsInTree } from '@/lib/db/queries/owner-links';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';

export interface ResolveMediaUploadTargetsParams {
    requestedTreeId: number | null;
    requestedOwnerId: number | null;
    currentUserId: number;
    personId: number | null;
    caseId: number | null;
    ownerTable: string | null;
    ownerRecordId: number | null;
    /** The owner's vital fact the upload is for, set by the panel it was added from (ADR 0030). */
    ownerFact?: string | null;
}

export interface ValidatedMediaUploadTargets {
    scope: Awaited<ReturnType<typeof resolveTreeScope>>;
    personId: number | null;
    caseId: number | null;
    owner: { table: MediaOwnerTable; id: number; fact: MediaOwnerFact | null } | null;
}

function validateTargetId(value: number | null, label: string): number | null {
    if (value === null) return null;
    if (!Number.isInteger(value) || value <= 0) {
        throw new ValidationError(`A valid ${label} is required`);
    }
    return value;
}

/**
 * Resolve write scope, then validate every optional upload target against that
 * scope. Missing and cross-tree records deliberately share NotFoundError.
 */
export async function resolveMediaUploadTargets(
    params: ResolveMediaUploadTargetsParams,
): Promise<ValidatedMediaUploadTargets> {
    const scope = await resolveTreeScope(
        { treeId: params.requestedTreeId, ownerId: params.requestedOwnerId },
        params.currentUserId,
    );
    if (scope.permission === 'view') {
        throw new AccessError('You only have view permission for this tree');
    }

    const personId = validateTargetId(params.personId, 'personId');
    const caseId = validateTargetId(params.caseId, 'caseId');
    const hasOwnerTable = params.ownerTable !== null;
    const hasOwnerRecordId = params.ownerRecordId !== null;
    if (hasOwnerTable !== hasOwnerRecordId) {
        throw new ValidationError('ownerTable and ownerRecordId must be provided together');
    }

    let owner: ValidatedMediaUploadTargets['owner'] = null;
    if (hasOwnerTable && hasOwnerRecordId) {
        if (!isMediaOwnerTable(params.ownerTable)) {
            throw new ValidationError(`Invalid ownerTable: ${params.ownerTable}`);
        }
        const ownerId = validateTargetId(params.ownerRecordId, 'ownerRecordId');
        const fact = params.ownerFact ?? null;
        if (fact !== null && !isMediaOwnerFactFor(params.ownerTable, fact)) {
            throw new ValidationError(`Invalid ownerFact for ${params.ownerTable}: ${fact}`);
        }
        owner = { table: params.ownerTable, id: ownerId!, fact };
    } else if (params.ownerFact != null) {
        throw new ValidationError('ownerFact needs ownerTable and ownerRecordId');
    }

    if (personId !== null && !(await ownerExistsInTree(MEDIA_OWNER_TABLES.PEOPLE, personId, scope.treeId))) {
        throw new NotFoundError('Person not found in this tree');
    }
    if (caseId !== null && !(await caseExistsInTree(caseId, scope.treeId))) {
        throw new NotFoundError('Case not found in this tree');
    }
    if (owner !== null && !(await ownerExistsInTree(owner.table, owner.id, scope.treeId))) {
        throw new NotFoundError('Owner record not found in this tree');
    }

    return { scope, personId, caseId, owner };
}

/** The links a new upload gets: its person, then its owner record or fact, each once. */
export function uploadLinks(
    targets: ValidatedMediaUploadTargets,
): Array<{ ownerTable: MediaOwnerTable; ownerId: number; ownerFact: MediaOwnerFact | null }> {
    const links: Array<{ ownerTable: MediaOwnerTable; ownerId: number; ownerFact: MediaOwnerFact | null }> = [];
    if (targets.personId !== null) {
        links.push({ ownerTable: 'People', ownerId: targets.personId, ownerFact: null });
    }
    const owner = targets.owner;
    if (owner !== null && !links.some(
        link => link.ownerTable === owner.table && link.ownerId === owner.id && link.ownerFact === owner.fact,
    )) {
        links.push({ ownerTable: owner.table, ownerId: owner.id, ownerFact: owner.fact });
    }
    return links;
}
