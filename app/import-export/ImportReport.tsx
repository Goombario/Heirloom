'use client';

import { useTranslations } from 'next-intl';
import { DatesToCheckFlag, ReviewLink } from '@/app/components/ui';

/**
 * What an import left to look at: the data checks' dates to check (FR-3,
 * #835), with the same flag as the family hero, and the possible duplicate pairs (#822).
 * Nothing renders when both are zero or unknown.
 */
export function ImportReport({ datesToCheck, duplicates }: { datesToCheck: number | null; duplicates: number | null }) {
    const t = useTranslations('importExport');
    const tHome = useTranslations('home');
    const checks = datesToCheck ?? 0;
    const dupes = duplicates ?? 0;
    if (checks <= 0 && dupes <= 0) return null;
    return (
        <div className="rounded-lg border border-border bg-surface p-3 text-sm">
            <p className="font-medium text-text">{t('import_report_title')}</p>
            {checks > 0 && <DatesToCheckFlag className="mt-2" count={checks} href="/data-checks" />}
            {dupes > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-text-secondary">
                    {tHome('suggestion_duplicates', { count: dupes })}
                    <ReviewLink href="/people?filter=duplicates" label={t('import_report_duplicates_review', { count: dupes })} />
                </p>
            )}
        </div>
    );
}
