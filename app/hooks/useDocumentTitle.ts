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
// A prefix such as "(52%) " while photo work runs (#207). It goes through this one
// observer: a second observer that rewrote the title would fight this one forever.
let prefix: ((title: string) => string) | null = null;

function apply(): void {
    const base = mounted[mounted.length - 1]?.title ?? APP_NAME;
    const want = prefix ? prefix(base) : base;
    if (document.title !== want) document.title = want;
}

function sync(): void {
    const needed = mounted.length > 0 || prefix != null;
    if (needed && !observer && typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(apply);
        observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    } else if (!needed && observer) {
        observer.disconnect();
        observer = null;
    }
    apply();
}

/** Put a prefix on the tab title, whatever page sets it; null takes it off. */
export function setDocumentTitlePrefix(next: ((title: string) => string) | null): void {
    prefix = next;
    sync();
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
        sync();
        return () => {
            mounted.splice(mounted.indexOf(entry), 1);
            sync();
        };
    }, [title]);
}
