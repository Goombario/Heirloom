'use client';

import { useTranslations } from 'next-intl';
import { useTree } from '@/app/contexts/TreeContext';
import { useMyTrees } from '@/app/hooks/useMyTrees';
import { useTreeDisplayName } from '@/app/hooks/useTreeDisplayName';

/**
 * The active tree's display name, as the header's tree switcher shows it. A null
 * `activeTreeId` means the user's default tree, which is the first of their own
 * trees (Id ASC). Pages that act on the whole tree name it with this (FR-2).
 */
export function useActiveTreeName(): string {
  const { activeTreeId, activeTreeName } = useTree();
  const { trees } = useMyTrees();
  const treeName = useTreeDisplayName();
  const t = useTranslations('nav');
  const defaultTree = trees[0];
  const activeOwnTree = activeTreeId === null
    ? defaultTree
    : trees.find(tree => tree.Id === activeTreeId);
  return treeName(activeOwnTree?.Name ?? activeTreeName ?? defaultTree?.Name) ?? t('my_tree');
}
