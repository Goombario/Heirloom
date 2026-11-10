'use client';

import React from 'react';
import { PageShell } from '@/app/components/ui/PageShell';
import { DetailHero } from '@/app/components/ui/DetailHero';

/**
 * Loading-state placeholders built on the `.skeleton` class (globals.css),
 * which provides the theme-aware background + pulse animation. The
 * prefers-reduced-motion guard in globals.css disables the pulse automatically.
 */

/** A single shimmering placeholder block. Size it via `className` or `style`. */
export function Skeleton({
    className = '',
    style,
}: {
    className?: string;
    style?: React.CSSProperties;
}) {
    return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

/** Vertical list of placeholder rows (avatar circle + two text bars). For table/list pages. */
export function SkeletonList({ rows = 8 }: { rows?: number }) {
    return (
        <div aria-busy="true" className="p-2">
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-3">
                    <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                    <div className="flex-1 flex flex-col gap-2">
                        <Skeleton className="h-3 w-[32%]" />
                        <Skeleton className="h-2.5 w-[20%]" />
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * Full-page placeholder for the detail pages: a hero with an avatar + title,
 * then a two-column body (timeline on the left, rail cards on the right). The
 * hero is the same `DetailHero` tone the loaded page paints — the dark island for
 * person and family, the light card for cases — so it doesn't flash (#698).
 */
export function DetailSkeleton({ heroTone = 'dark' }: { heroTone?: 'dark' | 'light' }) {
    return (
        <PageShell variant="detail" busy>
                {/* Hero */}
                <DetailHero tone={heroTone} data-testid="detail-skeleton-hero" className="flex gap-[18px] items-center">
                    <Skeleton className="w-20 h-20 rounded-full shrink-0" />
                    <div className="flex-1 flex flex-col gap-2.5">
                        <Skeleton className="h-[26px] w-[40%]" />
                        <Skeleton className="h-3 w-[25%]" />
                        <div className="flex gap-2 mt-1.5">
                            <Skeleton className="h-[34px] w-20 rounded-lg" />
                            <Skeleton className="h-[34px] w-[110px] rounded-lg" />
                        </div>
                    </div>
                </DetailHero>
                {/* Two-column body */}
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_320px] gap-6">
                    <div className="flex flex-col gap-3">
                        <Skeleton className="h-4 w-[30%]" />
                        <div className="card card-pad flex flex-col gap-3.5">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="flex flex-col gap-1.5">
                                    <Skeleton className="h-[13px] w-[35%]" />
                                    <Skeleton className="h-[11px] w-[55%]" />
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-col gap-3">
                        <Skeleton className="h-4 w-[50%]" />
                        <div className="card card-pad flex flex-col gap-3">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="flex items-center gap-2.5">
                                    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                                    <Skeleton className="h-3 flex-1" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
        </PageShell>
    );
}

/** Grid of placeholder tiles. For photo/case grids. */
export function SkeletonGrid({
    items = 8,
    columns = 'repeat(auto-fill, minmax(160px, 256px))',
    aspectRatio = '1 / 1',
    gap = 12,
    className,
}: {
    items?: number;
    columns?: string | null;
    aspectRatio?: string;
    gap?: number;
    className?: string;
}) {
    // columns/aspectRatio/gap are caller-driven (dynamic) — they stay inline unless
    // a caller supplies responsive grid utility classes and explicitly opts out of
    // the inline column template with columns={null}.
    const gridStyle = columns ? { gridTemplateColumns: columns, gap } : { gap };
    return (
        <div aria-busy="true" className={`grid${className ? ` ${className}` : ''}`} style={gridStyle}>
            {Array.from({ length: items }).map((_, i) => (
                <Skeleton key={i} className="w-full" style={{ aspectRatio }} />
            ))}
        </div>
    );
}
