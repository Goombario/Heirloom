'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/app/components/ui/Badge';
import { PlaceCard } from './PlaceCard';
import type { PlaceSummary } from '@/lib/data/types';

export function PlaceGroupSection({
  title, titleHref, rolledCount, places,
}: { title: string; titleHref?: string; rolledCount: number; places: PlaceSummary[] }) {
  const t = useTranslations('places');
  return (
    <section className="mb-6">
      <div className="flex items-center gap-3 mb-3">
        {titleHref ? (
          <Link href={titleHref} className="serif text-2xl font-semibold text-text hover:underline">{title}</Link>
        ) : (
          <span className="serif text-2xl font-semibold text-text">{title}</span>
        )}
        <div className="flex-1 h-px bg-border" />
        <Badge tone="neutral" className="shrink-0 tabular-nums" title={t('group_places_count', { count: rolledCount })}>
          {t('group_places_count', { count: rolledCount })}
        </Badge>
      </div>
      {places.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ gridAutoRows: '1fr' }}>
          {places.map((p) => (
            <PlaceCard key={p.id ?? p.name} id={p.id} name={p.name} count={p.count} peopleCount={p.peopleCount} faces={p.faces} />
          ))}
        </div>
      )}
    </section>
  );
}
