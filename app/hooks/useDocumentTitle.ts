'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

/** The product name. A brand, so it isn't translated. */
const APP_NAME = 'Heirloom';

// The root layout's <title> is React's, and a later commit writes its text back to
// the bare app name, so a one-shot `document.title =` lasted half a second (#729).
// One observer re-applies the newest mounted page's title whenever the head
// changes. A single shared "wanted" title (the last one mounted) means two mounted
// callers can never fight over it.
const mounted: { title: string }[] = [];
let observer: MutationObserver | null = null;

function apply(): void {
    const want = mounted[mounted.length - 1]?.title ?? APP_NAME;
    if (document.title !== want) document.title = want;
}

/**
 * Sets the browser tab to "<page> - Heirloom" through one translated pattern
 * (`common.doc_title`) and restores the bare app name on unmount (#729). Pass the
 * page's own translated heading, so the tab and the h1 can't drift apart. Nothing
 * (for example a record still loading) shows the app name alone.
 */
export function useDocumentTitle(pageName: string | null | undefined): void {
    const t = useTranslations('common');
    const title = pageName ? t('doc_title', { page: pageName, app: APP_NAME }) : APP_NAME;
    useEffect(() => {
        const entry = { title };
        mounted.push(entry);
        apply();
        if (!observer && typeof MutationObserver !== 'undefined') {
            observer = new MutationObserver(apply);
            observer.observe(document.head, { subtree: true, childList: true, characterData: true });
        }
        return () => {
            mounted.splice(mounted.indexOf(entry), 1);
            if (mounted.length === 0) {
                observer?.disconnect();
                observer = null;
            }
            apply();
        };
    }, [title]);
}
