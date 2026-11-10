/** @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    historyTraversalTestUtils,
    installHistoryTraversalGuard,
} from '@/app/components/historyTraversalGuard';

const { HISTORY_POINT_KEY } = historyTraversalTestUtils;

function traversalState(point: number) {
    return { [HISTORY_POINT_KEY]: point, __NA: true };
}

class FakeNavigation extends EventTarget {
    dispatchTraversal(sameDocument = true) {
        const event = new Event('navigate', { cancelable: true }) as Event & {
            destination: { sameDocument: boolean };
            navigationType: string;
        };
        Object.assign(event, {
            destination: { sameDocument },
            navigationType: 'traverse',
        });
        this.dispatchEvent(event);
        return event;
    }
}

describe('history traversal guard', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/people');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(window, 'navigation');
    });

    it('cancels same-document Navigation API traversals without changing history', () => {
        const navigation = new FakeNavigation();
        Object.defineProperty(window, 'navigation', { configurable: true, value: navigation });
        const confirmNavigation = vi.fn().mockReturnValue(false);
        const initialLength = window.history.length;
        const cleanup = installHistoryTraversalGuard(window, confirmNavigation);

        const event = navigation.dispatchTraversal();

        expect(confirmNavigation).toHaveBeenCalledOnce();
        expect(event.defaultPrevented).toBe(true);
        expect(window.history.length).toBe(initialLength);
        cleanup();
    });

    it('allows an accepted Navigation API traversal exactly once', () => {
        const navigation = new FakeNavigation();
        Object.defineProperty(window, 'navigation', { configurable: true, value: navigation });
        const confirmNavigation = vi.fn().mockReturnValue(true);
        const cleanup = installHistoryTraversalGuard(window, confirmNavigation);

        const event = navigation.dispatchTraversal();

        expect(confirmNavigation).toHaveBeenCalledOnce();
        expect(event.defaultPrevented).toBe(false);
        cleanup();
    });

    it('does not duplicate prompts or entries across repeated Back and Forward outcomes', () => {
        const confirmNavigation = vi.fn()
            .mockReturnValueOnce(false) // dismiss Back
            .mockReturnValueOnce(true) // accept Back
            .mockReturnValueOnce(false) // dismiss Forward
            .mockReturnValueOnce(true); // accept Forward
        const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
        const cleanup = installHistoryTraversalGuard(window, confirmNavigation);
        const initialLength = window.history.length;

        window.history.pushState({ page: 'form' }, '', '/people/new');
        const formState = window.history.state;
        expect(formState[HISTORY_POINT_KEY]).toBe(1);

        // Back dismissed, followed by the guard's compensating Forward popstate.
        window.dispatchEvent(new PopStateEvent('popstate', { state: traversalState(0) }));
        expect(go).toHaveBeenLastCalledWith(1);
        window.dispatchEvent(new PopStateEvent('popstate', { state: formState }));

        // Back accepted; the next Forward is independently dismissible.
        window.dispatchEvent(new PopStateEvent('popstate', { state: traversalState(0) }));
        window.dispatchEvent(new PopStateEvent('popstate', { state: formState }));
        expect(go).toHaveBeenLastCalledWith(-1);
        window.dispatchEvent(new PopStateEvent('popstate', { state: traversalState(0) }));

        // A later Forward is not swallowed by stale compensation state.
        window.dispatchEvent(new PopStateEvent('popstate', { state: formState }));

        expect(confirmNavigation).toHaveBeenCalledTimes(4);
        expect(go.mock.calls).toEqual([[1], [-1]]);
        expect(window.history.length).toBe(initialLength + 1);
        cleanup();
    });

    it('preserves the point across replaceState and advances it only on pushState', () => {
        const cleanup = installHistoryTraversalGuard(window, () => true);

        expect(window.history.state[HISTORY_POINT_KEY]).toBe(0);
        window.history.replaceState({ replaced: true, __NA: true, tree: ['people'] }, '', '/people?view=table');
        expect(window.history.state).toMatchObject({
            replaced: true,
            __NA: true,
            tree: ['people'],
            [HISTORY_POINT_KEY]: 0,
        });
        window.history.pushState({ pushed: true, __NA: true, tree: ['people', 'new'] }, '', '/people/new');
        expect(window.history.state).toMatchObject({
            pushed: true,
            __NA: true,
            tree: ['people', 'new'],
            [HISTORY_POINT_KEY]: 1,
        });

        cleanup();
    });

    it('returns to the exact source point when another traversal interleaves with compensation', () => {
        const confirmNavigation = vi.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);
        const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
        const cleanup = installHistoryTraversalGuard(window, confirmNavigation);

        window.history.pushState({ page: 'form' }, '', '/people/new');
        const formState = window.history.state;

        window.dispatchEvent(new PopStateEvent('popstate', { state: traversalState(0) }));
        expect(go).toHaveBeenLastCalledWith(1);

        // A rapid second Back reaches another tracked point before the first
        // compensation completes. It is redirected to the same source point.
        window.dispatchEvent(new PopStateEvent('popstate', { state: traversalState(-1) }));
        expect(go).toHaveBeenLastCalledWith(2);
        window.dispatchEvent(new PopStateEvent('popstate', { state: formState }));

        // The exact restoration clears suppression; the next Back is prompted.
        window.dispatchEvent(new PopStateEvent('popstate', { state: traversalState(0) }));
        expect(confirmNavigation).toHaveBeenCalledTimes(2);
        expect(go.mock.calls).toEqual([[1], [2]]);

        cleanup();
    });
});
