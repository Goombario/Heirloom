'use client';

import { Lifespan } from '@/app/components/ui';
import type { TreeLifespan } from './types';

/**
 * A tree card's (or a descendants row's) life span through the one `Lifespan`
 * (#808, DV-1): "1889 – 1960", an en dash with thin spaces (#934), not the old
 * hyphen "1889 - 1960".
 * The years arrive pre-formatted from the tree service. Muted, as a compact
 * lifespan is: on the tree the dates only tell people apart (#935).
 */
export function TreeCardLifespan({ lifespan, className }: { lifespan: TreeLifespan; className?: string }) {
  return (
    <Lifespan
      preformatted
      birth={lifespan.birth}
      death={lifespan.death}
      status={lifespan.deceased ? 'deceased' : undefined}
      className={className}
    />
  );
}
