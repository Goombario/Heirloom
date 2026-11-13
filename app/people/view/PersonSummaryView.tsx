'use client';

import { useTranslations } from 'next-intl';
import ProfileImage from '@/app/components/ProfileImage';
import { getInitials } from '@/lib/utils/initials';
import { CoverBand, DetailBody, Lifespan, PageShell, cx } from '@/app/components/ui';
import { Skeleton } from '@/app/components/SkeletonLoader';
import { displayFullName } from '@/lib/utils/names';
import type { PersonSummary } from './personCache';
import { avatarClass } from './derive';

/**
 * Intermediate paint for a person whose full record isn't cached yet but whose
 * identity summary is (from a previously-loaded list/tree). Renders the cover band
 * with the exact known identity — photo, name, dates and places — so a
 * tap-through is instant instead of a blank surface, with the body sections shown
 * as skeletons until `people.get` resolves and the full view replaces this (#2).
 *
 * It deliberately shows ONLY fields the summary knows accurately. Count-derived
 * badges (sources/role), the last-location map, and descendants are omitted here
 * and appear when the full record loads — progressive, never wrong.
 */
export function PersonSummaryView({ summary, treeId }: { summary: PersonSummary; treeId: number | null }) {
    const t = useTranslations('personDetail');
    const name = displayFullName(summary) || t('unknown');

    return (
        <PageShell variant="detail" busy>
            {/* The live page's cover band (#49), with the identity the summary knows. */}
            <CoverBand
                title={name}
                titleSize="hero"
                meta={<Lifespan variant="full" birth={summary.BirthDate} death={summary.DeathDate} birthPlace={summary.BirthPlace} deathPlace={summary.DeathPlace} />}
                portrait={(
                    <span className={cx('relative grid place-items-center rounded-card overflow-hidden', avatarClass(summary.Sex))}>
                        <span aria-hidden="true" className="serif text-4xl text-[color:var(--color-on-media)] opacity-70">{getInitials(summary.FirstName, summary.LastName)}</span>
                        {summary.PrimaryMediaId && treeId !== null && (
                            <span className="absolute inset-0">
                                <ProfileImage
                                    mediaId={summary.PrimaryMediaId}
                                    treeId={treeId}
                                    alt={name}
                                    focalX={summary.FocalX ?? 50}
                                    focalY={summary.FocalY ?? 50}
                                    focalRadius={summary.FocalRadius ?? null}
                                    containerWidth={320}
                                    containerHeight={240}
                                    circular={false}
                                />
                            </span>
                        )}
                    </span>
                )}
                lead={<div className="grid gap-2"><Skeleton className="h-4 w-[90%]" /><Skeleton className="h-4 w-[80%]" /><Skeleton className="h-4 w-[60%]" /></div>}
            />

            {/* Body: still loading; the live page's main column and rail. */}
            <DetailBody sheet rail={(
                <div className="flex flex-col gap-3">
                    <Skeleton className="h-14 w-full" />
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-2.5">
                            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                            <Skeleton className="h-3 flex-1" />
                        </div>
                    ))}
                </div>
            )}>
                <div className="flex flex-col gap-3.5">
                    <Skeleton className="h-4" style={{ width: '30%' }} />
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="flex flex-col gap-1.5">
                            <Skeleton className="h-[13px]" style={{ width: '35%' }} />
                            <Skeleton className="h-[11px]" style={{ width: '55%' }} />
                        </div>
                    ))}
                </div>
            </DetailBody>
        </PageShell>
    );
}
