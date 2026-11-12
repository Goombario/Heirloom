'use client';

import { useTranslations } from 'next-intl';
import GuardedLink from '@/app/components/GuardedLink';
import { ArrowUpRight, Network } from '@/lib/icons';
import { cx } from './cx';

const TILE_SIZE = { 32: 'w-8 h-8', 36: 'w-9 h-9', 40: 'w-10 h-10' } as const;

/**
 * An outlined icon tile (C8 on #55): a 1px muted edge and a secondary-text icon on
 * the card fill, both above 3:1, replacing the grey `--surface-2` tile that failed
 * contrast. Open in tree, Home's Quick add and the Tools menu use it.
 */
export function IconTile({ children, size = 36, className }: { children: React.ReactNode; size?: 32 | 36 | 40; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx('icon-tile grid place-items-center shrink-0 rounded-btn', TILE_SIZE[size], className)}
    >
      {children}
    </span>
  );
}

/**
 * "Open in tree · Starts from Anna ↗" (#55): a bordered white row at the top of the
 * person and family rails and inside Home's pick-up card. It opens `/tree` rooted
 * at that person. The wording is "Starts from", not "Centred on" (C7), because the
 * tree doesn't always put its root in the middle.
 */
export function OpenInTreeRow({ personId, firstName, className }: {
  personId: number;
  /** The first name, or the full name when there is none. */
  firstName: string;
  className?: string;
}) {
  const t = useTranslations('detailKit');
  return (
    <GuardedLink
      href={`/tree?rootId=${personId}`}
      className={cx(
        'open-in-tree flex items-center gap-3 rounded-card border border-border bg-card px-3 py-2.5 text-text no-underline',
        'hover:bg-hover-surface focus-ring transition-colors',
        className,
      )}
    >
      <IconTile><Network className="w-[18px] h-[18px]" /></IconTile>
      <span className="grid min-w-0 flex-1">
        <span className="text-sm font-semibold">{t('open_in_tree')}</span>
        <span className="text-meta text-text-muted truncate">{t('starts_from', { name: firstName })}</span>
      </span>
      <ArrowUpRight className="w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />
    </GuardedLink>
  );
}

/**
 * A quick-create tile (#53): an outlined `IconTile` over a short label, the whole
 * tile one link. Home's Quick add rail (New person, New family, New case) uses it.
 */
export function TileLink({ href, icon, label, className }: { href: string; icon: React.ReactNode; label: string; className?: string }) {
  return (
    <GuardedLink
      href={href}
      className={cx(
        'tile-link grid justify-items-center gap-1.5 rounded-card border border-border bg-card px-2 py-3 text-center',
        'text-meta font-semibold text-text no-underline transition-colors hover:bg-hover-surface focus-ring',
        className,
      )}
    >
      <IconTile size={32}>{icon}</IconTile>
      {label}
    </GuardedLink>
  );
}
