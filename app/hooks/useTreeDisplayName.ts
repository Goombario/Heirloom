'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { treeDisplayName } from '@/lib/utils/tree-name';

type TreeNameFormatter = {
  (name: string): string;
  (name: string | null | undefined): string | null;
};

/** Tree names as readers see them: the stored default "My Tree" is translated (#704). */
export function useTreeDisplayName(): TreeNameFormatter {
  const t = useTranslations('nav');
  const defaultLabel = t('my_tree');
  return useCallback(
    (name: string | null | undefined) => treeDisplayName(name, defaultLabel),
    [defaultLabel],
  ) as TreeNameFormatter;
}
