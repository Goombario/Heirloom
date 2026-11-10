'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import { citeClass } from '@/app/components/ui';

interface CiteProps {
    n?: number;
    empty?: boolean;
    /** Citation is queued until its new person or family record is saved. */
    pending?: boolean;
    factLabel?: string;
    /** An empty pin for a viewer, who can search records for the fact but not cite it (#1028). */
    searchOnly?: boolean;
    /** The "+" after a cited fact's chips, which attaches another source (#900). Desktop read views only. */
    more?: boolean;
    sourceTitle?: string;
    onClick?: (anchor: HTMLElement) => void;
    tabIndex?: number;
}

export default function Cite({ n, empty, pending, factLabel, searchOnly = false, more = false, sourceTitle, onClick, tabIndex = 0 }: CiteProps) {
    const t = useTranslations('common');

    function handleClick(e: MouseEvent<HTMLSpanElement>) {
        e.preventDefault();
        e.stopPropagation();
        onClick?.(e.currentTarget);
    }

    function handleKeyDown(e: KeyboardEvent<HTMLSpanElement>) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.(e.currentTarget);
        }
    }

    if (empty || more) {
        // Fact labels are capitalised headings ("Birth"); mid-sentence they read lowercase.
        const fact = factLabel?.toLocaleLowerCase();
        const attachLabel = more
            ? t('attach_another_source_for', { fact: fact ?? '' })
            : searchOnly
                ? t('search_records_for', { fact: fact ?? '' })
                : fact ? t('attach_source_for', { fact }) : t('attach_source');
        const reveal = more ? ' cite-hover-pin cite-more-pin' : searchOnly ? ' cite-hover-pin' : '';
        // A pin that can't act yet (citations still loading) isn't a button: it
        // keeps its place on the line but stays out of the accessibility tree (#861).
        if (!onClick) {
            return <span className={`${citeClass({ empty: true, square: false })}${reveal}`} aria-hidden="true">+</span>;
        }
        return (
            <span
                className={`${citeClass({ empty: true, square: false })}${reveal}`}
                title={attachLabel}
                aria-label={attachLabel}
                role="button"
                tabIndex={tabIndex}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
            >
                +
            </span>
        );
    }

    if (pending) {
        const pendingLabel = t('pending_source');
        return (
            <span
                className={citeClass({ square: false })}
                title={pendingLabel}
                aria-label={pendingLabel}
                role="button"
                tabIndex={tabIndex}
                onClick={onClick ? handleClick : undefined}
                onKeyDown={onClick ? handleKeyDown : undefined}
            >
                …
            </span>
        );
    }

    const ariaLabel = sourceTitle
        ? t('source_label_with_title', { n: n ?? 0, title: sourceTitle })
        : t('source_label_n', { n: n ?? 0 });
    const titleAttr = sourceTitle
        ? t('view_in_library_with_title', { title: sourceTitle })
        : t('source_label_n', { n: n ?? 0 });
    return (
        <span
            className={citeClass({ square: false })}
            title={titleAttr}
            aria-label={ariaLabel}
            role="button"
            tabIndex={tabIndex}
            onClick={onClick ? handleClick : undefined}
            onKeyDown={onClick ? handleKeyDown : undefined}
        >
            {n}
        </span>
    );
}
