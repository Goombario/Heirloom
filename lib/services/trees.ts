import {
  listTreesForUser,
  getTree,
  createTree,
  renameTree,
  countTreesForUser,
  deleteTreeData,
  resolveDefaultTree,
  resolveTreeScope,
  type TreeScope,
} from '@/lib/db/queries/trees';
import { validateStringField, ValidationError } from '@/lib/validation';
import { AccessError } from '@/lib/data/errors';
import { cleanupMediaFilesCounting } from '@/lib/media-thumbnail';
import type { Tree } from '@/lib/db/schema';

/**
 * Tree CRUD service. Trees are self-scoped (no ?treeId/?ownerId parsing):
 * list/create/rename/delete operate on the caller's own trees; getTreeInfo
 * additionally resolves shared access (the frontend uses it to restore a
 * persisted tree selection).
 */

const NOT_OWNER = 'Access denied: You do not own this tree';

function validateTreeName(name: unknown): string {
  const validated = validateStringField(name, 'Name', 200);
  if (!validated || !validated.trim()) {
    throw new ValidationError('Tree name is required');
  }
  return validated.trim();
}

/** Ensures the default tree exists so a first call always returns ≥ 1 tree. */
export async function listTreesService(currentUserId: number): Promise<Tree[]> {
  await resolveDefaultTree(currentUserId);
  return listTreesForUser(currentUserId);
}

export async function createTreeService(params: {
  name: unknown;
  currentUserId: number;
}): Promise<Tree> {
  const name = validateTreeName(params.name);
  return createTree({ OwnerId: params.currentUserId, Name: name });
}

/** Owner OR shared access — used by the frontend to restore a persisted selection. */
export async function getTreeInfoService(params: {
  id: number;
  currentUserId: number;
}): Promise<{ tree: Tree; permission: TreeScope['permission'] }> {
  const scope = await resolveTreeScope({ treeId: params.id }, params.currentUserId);
  const tree = await getTree(params.id);
  if (!tree) throw new AccessError(NOT_OWNER); // deleted between the two reads
  return { tree, permission: scope.permission };
}

async function getOwnedTree(id: number, currentUserId: number): Promise<Tree> {
  const tree = await getTree(id);
  // AccessError for "doesn't exist" too — no tree-id existence probing.
  if (!tree || tree.OwnerId !== currentUserId) throw new AccessError(NOT_OWNER);
  return tree;
}

export async function renameTreeService(params: {
  id: number;
  name: unknown;
  currentUserId: number;
}): Promise<Tree> {
  await getOwnedTree(params.id, params.currentUserId);
  return renameTree(params.id, validateTreeName(params.name));
}

/**
 * Deletes a tree and ALL its data in one transaction. NOT restorable from the
 * audit log (the wipe bypasses audit capture and removes the tree's audit rows)
 * — which is why the route requires the X-Confirm-Delete-Tree header and the UI
 * requires typing the tree's name. An account must always keep ≥ 1 tree.
 *
 * `cleanupWarningCount` is how many media files stayed on disk because their
 * unlink failed (#945): the tree is still gone, only disk space was left behind.
 */
export async function deleteTreeService(params: {
  id: number;
  currentUserId: number;
}): Promise<{ cleanupWarningCount: number }> {
  const tree = await getOwnedTree(params.id, params.currentUserId);
  // Fast-path friendly error; the authoritative ≥1-tree check runs again
  // INSIDE deleteTreeData's transaction under a row lock (concurrent deletes).
  if ((await countTreesForUser(params.currentUserId)) <= 1) {
    throw new ValidationError('Cannot delete your last tree');
  }
  const filePaths = await deleteTreeData(params.id, params.currentUserId);
  // Best-effort disk cleanup after commit (server mode only — local/PGlite
  // media lives in MediaBlob and cascades with the Media rows).
  return { cleanupWarningCount: await cleanupMediaFilesCounting(tree.OwnerId, filePaths) };
}
