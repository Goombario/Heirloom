'use client';

import { useTranslations } from 'next-intl';
import ProfileImage from '@/app/components/ProfileImage';
import { livingStatus } from '@/lib/living';
import { getInitials } from '@/lib/utils/initials';
import { PageShell, DetailHero, Lifespan, StatusMark } from '@/app/components/ui';
import { Skeleton } from '@/app/components/SkeletonLoader';
import { displayFullName } from '@/lib/utils/names';
import type { PersonSummary } from './personCache';
import { avatarClass } from './derive';
import { HeroName } from './heroParts';

/**
 * Intermediate paint for a person whose full record isn't cached yet but whose
 * identity summary is (from a previously-loaded list/tree). Renders the hero with
 * the exact known identity — photo, name, dates/places, sex, living — so a
 * tap-through is instant instead of a blank surface, with the body sections shown
 * as skeletons until `people.get` resolves and the full view replaces this (#2).
 *
 * It deliberately shows ONLY fields the summary knows accurately. Count-derived
 * badges (sources/role), the last-location map, and descendants are omitted here
 * and appear when the full record loads — progressive, never wrong.
 */
export function PersonSummaryView({ summary, treeId }: { summary: PersonSummary; treeId: number | null }) {
    const t = useTranslations('personDetail');
    const tc = useTranslations('common');

    const status = livingStatus(summary);
    const name = displayFullName(summary) || t('unknown');

    return (
        <PageShell variant="detail" busy>
            <DetailHero className="hero-flex flex-wrap">
                {/* Portrait — from the summary's primary media, exact */}
                <div className="w-40 h-40 rounded-full overflow-hidden shrink-0 border-[3px] border-[color:var(--color-border)] flex items-center justify-center">
                    {summary.PrimaryMediaId && treeId !== null ? (
                        <ProfileImage
                            mediaId={summary.PrimaryMediaId}
                            treeId={treeId}
                            alt={name}
                            focalX={summary.FocalX ?? 50}
                            focalY={summary.FocalY ?? 50}
                            focalRadius={summary.FocalRadius ?? null}
                            containerWidth={160}
                            containerHeight={160}
                            circular={true}
                            loading="eager"
                        />
                    ) : (
                        <div className={`${avatarClass(summary.Sex)} flex items-center justify-center text-4xl font-semibold`} style={{ width: '100%', height: '100%', color: 'var(--color-on-media)' }}>
                            {getInitials(summary.FirstName, summary.LastName)}
                        </div>
                    )}
                </div>

                <div className="flex-1 min-w-60">
                    <HeroName size="lg">{name}</HeroName>
                    <div className="text-base" style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
                        <Lifespan
                            variant="full"
                            birth={summary.BirthDate}
                            death={summary.DeathDate}
                            birthPlace={summary.BirthPlace}
                            deathPlace={summary.DeathPlace}
                        />
                    </div>
                    {/* Mirrors the live hero's meta line: status mark + word, then sex as text. */}
                    <div className="row gap-x-3 gap-y-1.5 flex-wrap">
                        {status === 'living' && (
                            <span className="inline-flex items-center gap-1.5 text-sm text-text">
                                <StatusMark status="living" />
                                {tc('living')}
                            </span>
                        )}
                        {summary.Sex && (
                            <span className="text-sm text-text-muted">
                                {summary.Sex === 'M' ? t('sex_male') : summary.Sex === 'F' ? t('sex_female') : t('sex_nonbinary')}
                            </span>
                        )}
                    </div>
                </div>
            </DetailHero>

            {/* Body — still loading; mirrors the real two-column layout */}
            <div className="layout-2col-content">
                <div className="flex flex-col gap-3.5 min-w-0">
                    <Skeleton className="h-4" style={{ width: '30%' }} />
                    <div className="card card-pad flex flex-col gap-3.5">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="flex flex-col gap-1.5">
                                <Skeleton className="h-[13px]" style={{ width: '35%' }} />
                                <Skeleton className="h-[11px]" style={{ width: '55%' }} />
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex flex-col gap-3">
                    <Skeleton className="h-4" style={{ width: '50%' }} />
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
