'use client';

import React from 'react';
import { PageShell } from '@/app/components/ui/PageShell';

/**
 * Loading-state placeholders built on the `.skeleton` class (globals.css),
 * which provides the theme-aware background + pulse animation. The
 * prefers-reduced-motion guard in globals.css disables the pulse automatically.
 */

/** A single shimmering placeholder block. Size it via `className` or `style`. */
export function Skeleton({
    className = '',
    style,
    'data-testid': testId,
}: {
    className?: string;
    style?: React.CSSProperties;
    'data-testid'?: string;
}) {
    return <div className={`skeleton ${className}`} style={style} aria-hidden="true" data-testid={testId} />;
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

/** Two text bars per row, the shape of a timeline or record row. */
function RowBars({ rows }: { rows: number }) {
    return (
        <>
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                    <Skeleton className="h-[13px] w-[35%]" />
                    <Skeleton className="h-[11px] w-[55%]" />
                </div>
            ))}
        </>
    );
}

/**
 * The v1.1 cover band while a record loads (#63): the same `cover` band, with a
 * 4:3 portrait hanging over its lower edge and the lead text beside it, so the
 * loaded `CoverBand` lands on the same shapes. `split` is the family page's two
 * partner halves. It draws bars, never an empty heading.
 */
export function CoverSkeleton({ portrait = 'single', className }: { portrait?: 'single' | 'split'; className?: string }) {
    return (
        <div className={`cover cover--cover cover--portrait${className ? ` ${className}` : ''}`} data-testid="cover-skeleton">
            <div className="hero-dark cover-band cover-band--cover">
                <div className="cover-band__text flex flex-col gap-3">
                    {portrait === 'split' && <Skeleton className="h-3 w-24" />}
                    <Skeleton className="h-9 w-[45%] max-w-[420px]" />
                    <Skeleton className="h-3.5 w-[30%] max-w-[300px]" />
                </div>
            </div>
            <div className="cover-below">
                <div className="cover-portrait">
                    {portrait === 'split' ? (
                        <div className="flex gap-1" data-testid="cover-skeleton-portrait">
                            <Skeleton className="flex-1 h-full rounded-card" />
                            <Skeleton className="flex-1 h-full rounded-card" />
                        </div>
                    ) : (
                        <Skeleton className="rounded-card" data-testid="cover-skeleton-portrait" />
                    )}
                </div>
                <div className="cover-lead grid gap-2">
                    <Skeleton className="h-4 w-[90%]" />
                    <Skeleton className="h-4 w-[80%]" />
                    <Skeleton className="h-4 w-[60%]" />
                </div>
            </div>
        </div>
    );
}

/**
 * The v1.1 detail body while a record loads (#63): the section index, the cream
 * main column and the rail, laid out by the same `detail-body` classes as
 * `DetailBody`, so nothing moves when the page arrives.
 */
export function DetailBodySkeleton({ index = true, divided = true, className }: { index?: boolean; divided?: boolean; className?: string }) {
    const classes = ['detail-body detail-body--rail detail-body--sheet', index && 'detail-body--index', divided && 'detail-body--divided', className];
    return (
        <div className={classes.filter(Boolean).join(' ')}>
            {index && (
                <div className="detail-body__index" aria-hidden="true">
                    <div className="flex flex-col gap-3 pl-2.5">
                        {[70, 55, 60, 50, 62].map((w) => <Skeleton key={w} className="h-3" style={{ width: `${w}%` }} />)}
                    </div>
                </div>
            )}
            <div className="detail-body__main">
                <div className="flex flex-col gap-3.5">
                    <Skeleton className="h-4 w-[30%]" />
                    <RowBars rows={4} />
                </div>
                <div className="flex flex-col gap-3.5">
                    <Skeleton className="h-4 w-[22%]" />
                    <RowBars rows={2} />
                </div>
            </div>
            <aside className="detail-body__rail">
                <div className="flex flex-col gap-3">
                    <Skeleton className="h-4 w-[50%]" />
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-2.5">
                            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                            <Skeleton className="h-3 flex-1" />
                        </div>
                    ))}
                </div>
            </aside>
        </div>
    );
}

/**
 * Full-page placeholder for the v1.1 desktop person and family pages (#63, #698):
 * the cover band with its 4:3 portrait, then the indexed body with its rail.
 */
export function DetailSkeleton({ portrait = 'single' }: { portrait?: 'single' | 'split' }) {
    return (
        <PageShell variant="detail" busy>
            <CoverSkeleton portrait={portrait} className={portrait === 'split' ? 'cover--family' : undefined} />
            <DetailBodySkeleton />
        </PageShell>
    );
}

/**
 * The research case workspace while it loads (#63): the short band, then the
 * three full-height panes (leads, journal, side panel) on the same grid.
 */
export function WorkspaceSkeleton() {
    return (
        <PageShell variant="workspace" busy className="research-ws flex flex-col" style={{ height: 'calc(100dvh - var(--nav-h))' }}>
            <div className="research-ws__band">
                <div className="cover cover--short" data-testid="workspace-skeleton">
                    <div className="hero-dark cover-band cover-band--short">
                        <div className="cover-band__text flex flex-col gap-2.5">
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="h-8 w-[40%] max-w-[420px]" />
                        </div>
                    </div>
                </div>
            </div>
            <div className="research-ws__panes">
                <div className="research-ws__rail flex flex-col gap-3">
                    <Skeleton className="h-3.5 w-[50%]" />
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
                <div className="research-ws__main">
                    <div className="research-ws__inner flex flex-col gap-3.5">
                        <Skeleton className="h-4 w-[25%]" />
                        <RowBars rows={5} />
                    </div>
                </div>
                <div className="research-ws__side flex flex-col gap-3">
                    <Skeleton className="h-3.5 w-[40%]" />
                    <Skeleton className="h-32 w-full" />
                    <Skeleton className="h-3 w-[70%]" />
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
