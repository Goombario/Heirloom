import { ValidationError } from '@/lib/validation';
import { NotFoundError } from '@/lib/data/errors';
import { isLinkOwnerTable, type LinkOwnerTable } from '@/lib/db/fact-tables';
import { linkOwnerExistsInTree } from '@/lib/db/queries/owner-links';

/** Validate an untrusted ownerTable + ownerId pair used by the polymorphic links. */
export function validatedOwner(ownerTable: string, ownerId: number): LinkOwnerTable {
  if (!isLinkOwnerTable(ownerTable)) {
    throw new ValidationError(`Invalid ownerTable: ${ownerTable}`);
  }
  if (!Number.isFinite(ownerId) || ownerId <= 0) {
    throw new ValidationError('A valid ownerId is required');
  }
  return ownerTable;
}

/**
 * IDOR guard: confirm the owner record (table, id) belongs to the resolved
 * tree. The table name is safe to interpolate — `validatedOwner` allowlists it
 * first. Every `LinkOwnerTable` (People/Families/Events/Sources/Places/Repository) now
 * carries its own "TreeId" column, so a single predicate covers all of them —
 * no per-table owner-column map needed.
 */
export async function assertOwnerInTree(
  ownerTable: LinkOwnerTable,
  ownerId: number,
  treeId: number,
): Promise<void> {
  if (!(await linkOwnerExistsInTree(ownerTable, ownerId, treeId))) {
    throw new NotFoundError('Record not found in this tree');
  }
}
