'use client';

import { useTranslations } from 'next-intl';
import { initialsFromName } from '@/lib/utils/initials';
import { Skeleton } from '@/app/components/SkeletonLoader';
import { CoverBand, PageShell } from '@/app/components/ui';
import { shortPlace } from '@/app/people/view/desktop/PersonCover';
import { kindKey } from './mobile/model';
import { SplitPortrait, type PortraitHalf } from './desktop/FamilyCover';
import type { FamilySummary } from './familyCache';
import { yearOnly, shortNameFromDisplay, computeEndedYear } from './derive';
import type { Person } from '@/lib/db/schema';

/**
 * Intermediate paint for a family whose full record isn't cached yet but whose
 * partnership summary is (from a previously-loaded families list). Renders the hero
 * with the known identity — both partner names/avatars and the marriage line — so a
 * tap-through is instant instead of a blank surface, with the body shown as
 * skeletons until `families.get` resolves and the full view replaces this.
 *
 * It deliberately shows ONLY fields the summary knows. Children, other partnerships,
 * sources, notes, and the map are omitted and appear when the full record loads —
 * progressive, never wrong.
 */
export function FamilySummaryView({ summary, treeId }: { summary: FamilySummary; treeId: number | null }) {
    const t = useTranslations('families');
    const tCommon = useTranslations('common');

    const tk = useTranslations('familyPhone');
    const a = shortNameFromDisplay(summary.husbandName);
    const b = shortNameFromDisplay(summary.wifeName);
    const shared = summary.partner1LastName && summary.partner1LastName === summary.partner2LastName ? summary.partner1LastName : null;
    // The same title rule as the cover: "Johan & Kristina Lindqvist", else both full names.
    const title = a && b
        ? (shared ? t('cover_title_shared', { a, b, last: shared }) : t('hero_title_both', { a: summary.husbandName ?? a, b: summary.wifeName ?? b }))
        : summary.husbandName || summary.wifeName || t('family_fallback');
    const began = yearOnly(summary.MarriageDate);
    const ended = computeEndedYear(
        summary.partner1DeathDate ? ({ DeathDate: summary.partner1DeathDate } as Person) : null,
        summary.partner2DeathDate ? ({ DeathDate: summary.partner2DeathDate } as Person) : null,
        summary.EndedDate,
        summary.MarriageDate,
    );
    const where = shortPlace(summary.MarriagePlace);
    const half = (id: number | null, name: string | null, sex: string | null, mediaId: number | null, focalX: number | null, focalY: number | null, focalRadius: number | null): PortraitHalf | null =>
        id == null ? null : { id, name: name || tCommon('unknown'), first: shortNameFromDisplay(name) || name || tCommon('unknown'), initials: initialsFromName(name), sex, mediaId, focalX, focalY, focalRadius };

    return (
        <PageShell variant="detail" busy>
                {/* The cover, painted from the summary the families list left behind. */}
                <CoverBand
                    eyebrow={tk(`kind_${kindKey(summary.Type)}`)}
                    title={title}
                    titleSize="hero"
                    meta={began || where ? (
                        <span className="cover-lifeline">
                            {began && <span className="date-mono">{ended && ended !== began ? `${began} – ${ended}` : began}</span>}
                            {began && where && ' · '}{where}
                        </span>
                    ) : undefined}
                    portrait={<SplitPortrait treeId={treeId} halves={[
                        half(summary.Partner1Id, summary.husbandName, summary.partner1Sex, summary.husbandMediaId, summary.husbandFocalX, summary.husbandFocalY, summary.husbandFocalRadius),
                        half(summary.Partner2Id, summary.wifeName, summary.partner2Sex, summary.wifeMediaId, summary.wifeFocalX, summary.wifeFocalY, summary.wifeFocalRadius),
                    ]} />}
                    lead={<Skeleton className="h-4" style={{ width: '60%' }} />}
                    className="cover--family"
                />

                {/* Body still loading. */}
                <div className="layout-2col-family mt-10">
                    <div className="flex flex-col gap-3.5 min-w-0">
                        <Skeleton className="h-4" style={{ width: '30%' }} />
                        <div className="card card-pad flex flex-col gap-3.5">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="flex flex-col gap-1.5">
                                    <Skeleton className="h-[13px]" style={{ width: '35%' }} />
                                    <Skeleton className="h-[11px]" style={{ width: '55%' }} />
                                </div>
                            ))}
                        </div>
                        <Skeleton className="h-4" style={{ width: '25%' }} />
                        <div className="card card-pad flex flex-col gap-3">
                            {Array.from({ length: 2 }).map((_, i) => (
                                <div key={i} className="flex items-center gap-2.5">
                                    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                                    <Skeleton className="h-3 flex-1" />
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
