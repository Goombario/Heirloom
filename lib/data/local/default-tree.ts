import { setDefaultTreeMemo } from '@/lib/db/queries/trees';
import { memoUntilWrite } from './memo-until-write';

/**
 * Remember each user's default tree until the next write (#1269). The local
 * build passes no tree id, so every read resolved the default tree with its own
 * query first, about eight per person page. The lowest-Id tree only changes
 * when a tree is deleted or replaced, and both are writes. Installed once, by
 * the local client.
 */
export function rememberDefaultTree(): void {
  const trees = memoUntilWrite<number, number>();
  setDefaultTreeMemo((userId, lookup) => trees.get(userId, lookup));
}
