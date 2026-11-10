'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PageShell } from '@/app/components/ui';
import { ArrowLeft, SearchX } from '@/lib/icons';
import { LIBRARY_SOURCES_HREF } from '@/app/library/links';

export type MissingRecord = 'person' | 'family' | 'case' | 'source' | 'repository' | 'place';

const BACK: Record<MissingRecord, { href: string; key: string }> = {
    person: { href: '/people', key: 'back_to_people' },
    family: { href: '/families', key: 'back_to_families' },
    case: { href: '/cases', key: 'back_to_cases' },
    source: { href: LIBRARY_SOURCES_HREF, key: 'back_to_library' },
    repository: { href: '/library?tab=repositories', key: 'back_to_library' },
    place: { href: '/places', key: 'back_to_places' },
};

/**
 * The one state for a record route whose record doesn't exist in the active
 * tree (#697): say so, link back to its list, and point at the audit log where
 * a deletion or merge would be recorded. Retry is deliberately absent — a
 * missing record won't reappear — and routes never silently fall back to the
 * list instead.
 */
export function RecordNotFoundMessage({ record, titleId, onBack }: {
    record: MissingRecord;
    /** Set inside a dialog: the title becomes an h2 carrying this id for `aria-labelledby`. */
    titleId?: string;
    /** Set inside a dialog that sits over the list: "back" closes it instead of navigating. */
    onBack?: () => void;
}) {
    const t = useTranslations('common');
    const back = BACK[record];
    return (
        <MissingState
            testId="record-not-found"
            title={t(`not_found_${record}`)}
            titleId={titleId}
            hint={t('not_found_hint')}
            backLabel={t(back.key)}
            backHref={back.href}
            onBack={onBack}
        >
            <Link href="/audit" className="text-text-muted hover:underline rounded focus-ring">{t('open_audit_log')}</Link>
        </MissingState>
    );
}

/**
 * The shared "nothing here" layout: icon, serif title, hint and a way back. Used by the
 * missing-record state and the app 404 (#708), so a dead link and a deleted record look
 * the same.
 */
export function MissingState({ testId, title, titleId, hint, backLabel, backHref, onBack, children }: {
    testId: string;
    title: string;
    /** Set inside a dialog: the title becomes an h2 carrying this id for `aria-labelledby`. */
    titleId?: string;
    hint: string;
    backLabel: string;
    backHref: string;
    /** "Back" as a button (closing a dialog) instead of a link to `backHref`. */
    onBack?: () => void;
    /** Secondary links beside "back". */
    children?: React.ReactNode;
}) {
    const Title = titleId ? 'h2' : 'h1';
    const backContent = (
        <>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            {backLabel}
        </>
    );
    const backClass = 'inline-flex items-center gap-1 font-medium text-link hover:underline cursor-pointer rounded focus-ring';
    return (
        <div data-testid={testId} className="text-center max-w-md mx-auto px-5">
            <SearchX className="w-8 h-8 mx-auto mb-3 text-text-muted" aria-hidden="true" />
            <Title id={titleId} className="serif text-xl font-semibold mb-2">{title}</Title>
            <p className="text-sm text-text-muted mb-4">{hint}</p>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
                {onBack
                    ? <button type="button" onClick={onBack} className={backClass}>{backContent}</button>
                    : <Link href={backHref} className={backClass}>{backContent}</Link>}
                {children}
            </div>
        </div>
    );
}

/** Full-page form of `RecordNotFoundMessage` for the detail routes. */
export default function RecordNotFound({ record }: { record: MissingRecord }) {
    return (
        <PageShell variant="detail" className="flex flex-col" contentClassName="flex-1 flex items-center justify-center">
            <RecordNotFoundMessage record={record} />
        </PageShell>
    );
}
