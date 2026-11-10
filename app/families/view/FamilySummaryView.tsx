'use client';

import { useTranslations } from 'next-intl';
import PersonAvatar from '@/app/components/PersonAvatar';
import { initialsFromName } from '@/lib/utils/initials';
import { Skeleton } from '@/app/components/SkeletonLoader';
import { PageShell, DetailHero, Lifespan } from '@/app/components/ui';
import type { FamilySummary } from './familyCache';
import { yearOnly, shortNameFromDisplay, heroTitleParts, heroSubtitleParts, heroCopy, computeEndedYear, formatUnionRange, unionEndNoteParts } from './derive';
import { FamilyHeroContent } from './FamilyHeroContent';
import type { Person } from '@/lib/db/schema';

function SummaryPartnerCard({
    name, sex, mediaId, focalX, focalY, focalRadius, deathDate, treeId, unknownLabel,
}: {
    name: string | null;
    sex: string | null;
    mediaId: number | null;
    focalX: number | null;
    focalY: number | null;
    focalRadius: number | null;
    deathDate: string | null;
    treeId: number | null;
    unknownLabel: string;
}) {
    const label = name?.trim() || unknownLabel;
    return (
        <div className="card card-pad row gap-3.5 p-4 items-center">
            <PersonAvatar
                mediaId={mediaId}
                treeId={treeId}
                name={label}
                initials={initialsFromName(name)}
                sex={sex}
                size={64}
                focalX={focalX}
                focalY={focalY}
                focalRadius={focalRadius}
            />
            <div className="flex-1 min-w-0">
                <div className="serif font-semibold leading-[1.2]" style={{ fontSize: 'var(--text-lg)', color: 'var(--color-text)' }}>
                    {label}
                </div>
                <Lifespan variant="full" death={deathDate} className="muted text-meta mt-0.5 block" />
            </div>
        </div>
    );
}

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

    const { title, subtitle } = heroCopy(
        heroTitleParts(shortNameFromDisplay(summary.husbandName), shortNameFromDisplay(summary.wifeName)),
        heroSubtitleParts(summary.Type, summary.MarriagePlace),
        t,
    );
    const began = yearOnly(summary.MarriageDate);
    // The summary cache carries the list query's pre-derived end columns, which are
    // the same explicit end-event the full view reads out of `events` — so the
    // instant paint shows the divorce range too rather than flashing a death year.
    const ended = computeEndedYear(
        summary.partner1DeathDate ? ({ DeathDate: summary.partner1DeathDate } as Person) : null,
        summary.partner2DeathDate ? ({ DeathDate: summary.partner2DeathDate } as Person) : null,
        summary.EndedDate,
        summary.MarriageDate,
    );
    const endNote = unionEndNoteParts({ date: summary.EndedDate, reason: summary.EndedReason });
    const centerNote = endNote ? t(endNote.reasonKey) : undefined;
    // Same formatter as FamilyDetailView: this summary is the instant paint before
    // the full record loads, so an inline copy would flash the pre-fix '1931' (and a
    // tight en dash) for a moment on every tap-through.
    const unionRange = formatUnionRange(began, ended);
    const centerLabel = unionRange || (began ? t('married_year', { year: began }) : undefined);

    return (
        <PageShell variant="detail" busy>

                {/* Segmented hero — title + partnership ribbon, painted from the summary */}
                <DetailHero>
                    <FamilyHeroContent
                        title={title}
                        subtitle={subtitle}
                        centerLabel={centerLabel}
                        centerNote={centerNote}
                        left={
                            <SummaryPartnerCard
                                name={summary.husbandName}
                                sex={summary.partner1Sex}
                                mediaId={summary.husbandMediaId}
                                focalX={summary.husbandFocalX}
                                focalY={summary.husbandFocalY}
                                focalRadius={summary.husbandFocalRadius}
                                deathDate={summary.partner1DeathDate}
                                treeId={treeId}
                                unknownLabel={tCommon('unknown')}
                            />
                        }
                        right={
                            <SummaryPartnerCard
                                name={summary.wifeName}
                                sex={summary.partner2Sex}
                                mediaId={summary.wifeMediaId}
                                focalX={summary.wifeFocalX}
                                focalY={summary.wifeFocalY}
                                focalRadius={summary.wifeFocalRadius}
                                deathDate={summary.partner2DeathDate}
                                treeId={treeId}
                                unknownLabel={tCommon('unknown')}
                            />
                        }
                    />
                </DetailHero>

                {/* Body — still loading; mirrors the real two-column layout */}
                <div className="layout-2col-family">
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
