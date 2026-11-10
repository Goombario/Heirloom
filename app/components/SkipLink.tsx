'use client';

import { useTranslations } from 'next-intl';

/**
 * "Skip to content", the first tab stop on every page (#798, KB-1). It jumps past
 * the navigation to the page's `<main>` (PageShell gives it `id="main-content"`
 * and `tabIndex={-1}`, so following the link moves focus there too). Hidden until
 * focused.
 */
export function SkipLink() {
    const t = useTranslations('common');
    return (
        <a href="#main-content" className="skip-link">
            {t('skip_to_content')}
        </a>
    );
}
