'use client';

import { useEffect } from 'react';

type InlineStyleSnapshot = {
    property: string;
    value: string;
    priority: string;
};

export interface DocumentScrollLockOptions {
    /** Preserve the tree canvas' existing overscroll behavior while locked. */
    overscrollBehavior?: string;
    /** Restore the captured page position after the final release. */
    restoreScroll?: boolean;
}

interface DocumentScrollLockState {
    scrollX: number;
    scrollY: number;
    body: InlineStyleSnapshot[];
    html: InlineStyleSnapshot[];
    restoreScroll: boolean;
}

const BODY_PROPERTIES = ['position', 'top', 'left', 'right', 'width'];
const HTML_PROPERTIES = ['overscroll-behavior'];

let lockCount = 0;
let state: DocumentScrollLockState | null = null;

function snapshotStyles(element: CSSStyleDeclaration, properties: string[]): InlineStyleSnapshot[] {
    return properties.map((property) => ({
        property,
        value: element.getPropertyValue(property),
        priority: element.getPropertyPriority(property),
    }));
}

function restoreStyles(element: CSSStyleDeclaration, snapshots: InlineStyleSnapshot[]) {
    for (const { property, value, priority } of snapshots) {
        if (value) element.setProperty(property, value, priority);
        else element.removeProperty(property);
    }
}

function offsetValue(value: number) {
    return value === 0 ? '0px' : `-${value}px`;
}

/**
 * Acquire the shared document lock. Releases are idempotent and only the final
 * release restores the document styles and captured scroll position.
 */
export function acquireDocumentScrollLock(options: DocumentScrollLockOptions = {}) {
    if (typeof document === 'undefined') return () => {};

    const body = document.body.style;
    const html = document.documentElement.style;

    if (lockCount === 0) {
        state = {
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            body: snapshotStyles(body, BODY_PROPERTIES),
            html: snapshotStyles(html, HTML_PROPERTIES),
            restoreScroll: options.restoreScroll !== false,
        };

        // Keep the document's scrolling element intact so sticky descendants do
        // not acquire body as a non-scrolling sticky ancestor. The fixed body
        // holds the page at its captured visual offset instead.
        body.setProperty('position', 'fixed');
        body.setProperty('top', offsetValue(state.scrollY));
        body.setProperty('left', offsetValue(state.scrollX));
        body.setProperty('right', '0');
        body.setProperty('width', '100%');
    }

    // A later tree-page acquire may request this even when a modal acquired the
    // lock first. The first snapshot remains the authority for final restore.
    if (options.overscrollBehavior !== undefined) {
        html.setProperty('overscroll-behavior', options.overscrollBehavior);
    }
    // A route-lifetime lock (the tree canvas) must prevent any nested consumer
    // from restoring an obsolete route position after navigation.
    if (options.restoreScroll === false && state) state.restoreScroll = false;

    lockCount += 1;
    let released = false;

    return () => {
        if (released) return;
        released = true;
        lockCount -= 1;
        if (lockCount > 0 || !state) return;

        const captured = state;
        state = null;
        restoreStyles(body, captured.body);
        restoreStyles(html, captured.html);
        if (captured.restoreScroll) window.scrollTo(captured.scrollX, captured.scrollY);
    };
}

/** Lock document scrolling while the consumer is active. */
export function useDocumentScrollLock(
    active = true,
    options?: DocumentScrollLockOptions,
) {
    const overscrollBehavior = options?.overscrollBehavior;
    const restoreScroll = options?.restoreScroll;

    useEffect(() => {
        if (!active) return;
        return acquireDocumentScrollLock({ overscrollBehavior, restoreScroll });
    }, [active, overscrollBehavior, restoreScroll]);
}
