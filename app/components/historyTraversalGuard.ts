const HISTORY_POINT_KEY = '__heirloomHistoryPoint';

type ConfirmNavigation = () => boolean;

interface NavigationDestinationLike {
    sameDocument: boolean;
}

interface NavigateEventLike extends Event {
    destination: NavigationDestinationLike;
    navigationType: string;
}

interface NavigationLike {
    addEventListener: (type: 'navigate', listener: EventListener) => void;
    removeEventListener: (type: 'navigate', listener: EventListener) => void;
}

type WindowWithNavigation = Window & { navigation?: NavigationLike };

function historyPoint(state: unknown): number | null {
    if (!state || typeof state !== 'object') return null;
    const point = (state as Record<string, unknown>)[HISTORY_POINT_KEY];
    return typeof point === 'number' && Number.isSafeInteger(point) ? point : null;
}

function stateWithHistoryPoint(state: unknown, point: number): Record<string, unknown> {
    if (state && typeof state === 'object' && !Array.isArray(state)) {
        return { ...(state as Record<string, unknown>), [HISTORY_POINT_KEY]: point };
    }
    return { [HISTORY_POINT_KEY]: point };
}

function installNavigationApiGuard(
    navigation: NavigationLike,
    confirmNavigation: ConfirmNavigation,
) {
    const onNavigate: EventListener = (rawEvent) => {
        const event = rawEvent as NavigateEventLike;
        if (
            event.navigationType !== 'traverse'
            || !event.destination.sameDocument
            || !event.cancelable
        ) return;

        if (!confirmNavigation()) event.preventDefault();
    };

    navigation.addEventListener('navigate', onNavigate);
    return () => navigation.removeEventListener('navigate', onNavigate);
}

function installPopStateGuard(win: Window, confirmNavigation: ConfirmNavigation) {
    const history = win.history;
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);
    let currentPoint = historyPoint(history.state) ?? 0;
    let restoringPoint: number | null = null;

    originalReplaceState(stateWithHistoryPoint(history.state, currentPoint), '');

    const trackedPushState: History['pushState'] = (data, unused, url) => {
        const nextPoint = currentPoint + 1;
        originalPushState(stateWithHistoryPoint(data, nextPoint), unused, url);
        currentPoint = nextPoint;
    };
    const trackedReplaceState: History['replaceState'] = (data, unused, url) => {
        originalReplaceState(stateWithHistoryPoint(data, currentPoint), unused, url);
    };

    history.pushState = trackedPushState;
    history.replaceState = trackedReplaceState;

    const onPopState = (event: PopStateEvent) => {
        const targetPoint = historyPoint(event.state);
        if (targetPoint === null) {
            restoringPoint = null;
            return;
        }

        if (restoringPoint !== null) {
            event.stopImmediatePropagation();
            if (targetPoint === restoringPoint) {
                currentPoint = targetPoint;
                restoringPoint = null;
                return;
            }

            history.go(restoringPoint - targetPoint);
            return;
        }

        if (targetPoint === currentPoint) return;
        if (confirmNavigation()) {
            currentPoint = targetPoint;
            return;
        }

        event.stopImmediatePropagation();
        restoringPoint = currentPoint;
        history.go(currentPoint - targetPoint);
    };

    // Capture and stop a dismissed traversal before Next's popstate listener can
    // unmount the dirty route. The compensating traversal changes no entries.
    win.addEventListener('popstate', onPopState, true);

    return () => {
        win.removeEventListener('popstate', onPopState, true);
        restoringPoint = null;
        if (history.pushState === trackedPushState) history.pushState = originalPushState;
        if (history.replaceState === trackedReplaceState) history.replaceState = originalReplaceState;
    };
}

/**
 * Guard same-document Back/Forward traversal without adding sentinel entries.
 * Chromium's Navigation API can cancel before the traversal commits. Other
 * browsers use indexed history state and an exact compensating traversal when
 * the user dismisses the prompt.
 */
export function installHistoryTraversalGuard(win: Window, confirmNavigation: ConfirmNavigation) {
    const navigation = (win as WindowWithNavigation).navigation;
    if (navigation) return installNavigationApiGuard(navigation, confirmNavigation);
    return installPopStateGuard(win, confirmNavigation);
}

export const historyTraversalTestUtils = {
    HISTORY_POINT_KEY,
    historyPoint,
};
