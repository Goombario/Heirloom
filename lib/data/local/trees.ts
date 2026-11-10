import type { TreesClient } from '../types';
import type { Tree } from '@/lib/db/schema';
import {
  listTreesService,
  createTreeService,
  getTreeInfoService,
  renameTreeService,
  deleteTreeService,
} from '@/lib/services/trees';
import { ensureLocalUser } from '../local-user';

/**
 * Tree management backed by in-browser PGlite. Local mode is single-USER but
 * (unlike sharing) multi-tree IS exposed here — the same services run
 * in-browser. deleteTreeService's disk cleanup loop is empty locally: media
 * bytes live in MediaBlob (cascades with the Media rows), FilePath is null.
 */
export class LocalTreesClient implements TreesClient {
  async list(): Promise<{ trees: Tree[]; count: number }> {
    const currentUserId = await ensureLocalUser();
    const trees = await listTreesService(currentUserId);
    return { trees, count: trees.length };
  }

  async get(id: number): Promise<{ tree: Tree; permission: 'owner' | 'edit' | 'contribute' | 'view' }> {
    const currentUserId = await ensureLocalUser();
    return getTreeInfoService({ id, currentUserId });
  }

  async create(name: string): Promise<Tree> {
    const currentUserId = await ensureLocalUser();
    return createTreeService({ name, currentUserId });
  }

  async rename(id: number, name: string): Promise<Tree> {
    const currentUserId = await ensureLocalUser();
    return renameTreeService({ id, name, currentUserId });
  }

  async remove(id: number): Promise<{ cleanupWarningCount: number }> {
    const currentUserId = await ensureLocalUser();
    return deleteTreeService({ id, currentUserId });
  }
}
