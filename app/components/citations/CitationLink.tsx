'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from '@/app/components/ExternalLink';
import { ExternalLink as ExternalLinkIcon } from '@/lib/icons';
import { isWebUrl } from '@/lib/desktop';
import { cx } from '@/app/components/ui';

/**
 * A citation's record link (`Citation.Url`, ADR 0025). An http(s) link opens
 * outside Heirloom; anything else, such as an imported file path, shows as text.
 */
export function CitationLink({ url, className }: { url: string; className?: string }) {
    const t = useTranslations('library');
    if (!isWebUrl(url)) {
        return <span className={cx('text-xs text-text-muted break-all', className)}>{url}</span>;
    }
    return (
        <ExternalLink
            href={url}
            title={t('open_record_link')}
            className={cx('inline-flex items-center gap-1.5 text-xs text-link hover:underline min-w-0 max-w-full', className)}
        >
            <ExternalLinkIcon size={12} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{url}</span>
        </ExternalLink>
    );
}
