'use client';

import { useTranslations } from 'next-intl';
import { decadeTicks, type YearStats } from './placeStats';

/**
 * A place's records by decade as a small column chart: the busiest decade in full
 * evidence colour with its count, the rest at half strength, and the years ticked
 * every 50 underneath. The phone place page's Years panel and the Explore card share it.
 */
export function DecadeChart({ decades, busiest }: { decades: YearStats['decades']; busiest: NonNullable<YearStats['busiest']> }) {
  const t = useTranslations('mobilePlaces');
  const W = 328, H = 88, base = 70, top = 14, bw = W / decades.length;
  // Columns keep a slim width over a short span instead of filling their slot.
  const barW = Math.min(Math.max(bw - 3, 2), 24);
  const from = decades[0].decade, to = decades[decades.length - 1].decade;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" role="img" aria-label={t('chart_label', { from, to })}>
      <line x1="0" x2={W} y1={base} y2={base} className="stroke-border" />
      {decades.map((d, i) => {
        if (d.count === 0) return null;
        const h = (d.count / busiest.count) * (base - top);
        const x = i * bw;
        const top1 = d.decade === busiest.decade;
        return (
          <g key={d.decade}>
            <rect x={x + (bw - barW) / 2} y={base - h} width={barW} height={h} rx="2" className="fill-[color:var(--color-date)]" opacity={top1 ? 1 : 0.5} />
            {top1 && <text x={x + bw / 2} y={base - h - 4} textAnchor="middle" className="fill-text font-mono text-xs font-medium">{d.count}</text>}
          </g>
        );
      })}
      {decadeTicks(from, to).map((d) => {
        const x = ((d - from) / 10) * bw + bw / 2;
        return (
          <g key={d}>
            <line x1={x} x2={x} y1={base} y2={base + 4} className="stroke-border" />
            <text x={Math.min(Math.max(x, 16), W - 16)} y={base + 16} textAnchor="middle" className="fill-text-muted font-mono text-xs">{d}</text>
          </g>
        );
      })}
    </svg>
  );
}
