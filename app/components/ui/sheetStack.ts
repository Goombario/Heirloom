/**
 * The open `Sheet`s, bottom to top (#1042), and the history step they add (#1053).
 *
 * The phone's Back gesture closes only the top sheet. While any sheet is open there is
 * one extra history entry on the same URL, so Back has something to take that never
 * leaves the page, even when the page was opened directly and the entry before it is
 * another document (which no guard can hold back). `UnsavedChangesProvider`'s history
 * guard asks `sheetsTakeBack()` first:
 * - Back off the step closes the top sheet, the same as its Cancel: a dirty sheet asks
 *   "Discard your changes?" instead. If a sheet is still open afterwards, the step is
 *   pushed again, so the next Back has one too.
 * - When the last sheet closes some other way, the step is taken back off history.
 * - A link followed from inside a sheet buries its step under the new page; Back from that
 *   page steps over it.
 */
interface OpenSheet {
    requestClose: () => void;
}

const STEP_KEY = '__heirloomSheetStep';

const stack: OpenSheet[] = [];
/** The step this module pushed, while it is still in history. */
let step: number | null = null;
let stepSeq = 0;
/** Our own history.back() that removes the step is on its way. */
let removingStep = false;
/** Back took the step but a sheet stayed open; push another once it lands. */
let restepOnPop = false;
let listening = false;

function stateWith(state: unknown, id: number): Record<string, unknown> {
    // Keep the router's own state, so returning to the page's entry is a no-op for it.
    return state && typeof state === 'object' && !Array.isArray(state)
        ? { ...(state as Record<string, unknown>), [STEP_KEY]: id }
        : { [STEP_KEY]: id };
}

function onPopState(event: PopStateEvent) {
    // The guard has had its say by now (it runs first), so our own Back is done.
    removingStep = false;
    if (restepOnPop) {
        restepOnPop = false;
        if (stack.length) pushStep();
        return;
    }
    // Back from a page opened out of a sheet lands on that sheet's old step. The sheet is
    // gone, so step over it rather than make Back look like it did nothing.
    const state = event.state as Record<string, unknown> | null;
    if (!stack.length && state && typeof state[STEP_KEY] === 'number') {
        removingStep = true;
        window.history.back();
    }
}

function pushStep() {
    if (step != null || typeof window === 'undefined') return;
    if (!listening) {
        window.addEventListener('popstate', onPopState);
        listening = true;
    }
    try {
        const id = ++stepSeq;
        window.history.pushState(stateWith(window.history.state, id), '');
        step = id;
    } catch { /* history unavailable: Back falls back to the guard holding the page */ }
}

function removeStep() {
    if (step == null) return;
    const current = (window.history.state as Record<string, unknown> | null)?.[STEP_KEY];
    const ours = current === step;
    step = null;
    // After a navigation the step is buried under the new page's entry; leave it be.
    if (!ours) return;
    removingStep = true;
    window.history.back();
}

/** Register an open sheet; returns the unregister function. */
export function pushSheet(sheet: OpenSheet): () => void {
    stack.push(sheet);
    pushStep();
    return () => {
        const i = stack.lastIndexOf(sheet);
        if (i >= 0) stack.splice(i, 1);
        // Wait a tick: a flow that swaps one sheet for the next keeps the same step.
        if (stack.length === 0) window.setTimeout(() => { if (stack.length === 0) removeStep(); }, 0);
    };
}

/** How many sheets are open; a full-screen layer under a sheet leaves Esc to it. */
export function openSheetCount(): number {
    return stack.length;
}

/**
 * Back (or Forward) is about to traverse history. Returns null when no sheet is
 * involved, true to let the traversal happen, and false to hold the page.
 */
export function sheetsTakeBack(): boolean | null {
    const top = stack[stack.length - 1];
    if (!top) {
        if (!removingStep) return null;
        removingStep = false;
        return true;
    }
    const hadStep = step != null;
    step = null;
    top.requestClose();
    if (!hadStep) return false;
    // The traversal only takes the step off; put one back if a sheet is still open.
    restepOnPop = true;
    return true;
}
