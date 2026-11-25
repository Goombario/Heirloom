/**
 * The keyboard shortcuts (#32): one registry drives both the key handling and the
 * cheatsheet, so the list can't drift from what the keys do.
 *
 * Letters match on `KeyboardEvent.code` (the physical key), so `g` then `p` works on
 * a Russian layout too. Sequences start with `g` (go to) or `n` (new). Character
 * shortcuts can be turned off in Options › Keyboard (WCAG 2.1.4); Ctrl/⌘ shortcuts
 * and Esc always work.
 */

/** A place `g` then a letter goes to. `labelKey` is in the `nav` namespace. */
export interface GoShortcut { letter: string; href: string; labelKey: string }

export const GO_SHORTCUTS: readonly GoShortcut[] = [
    { letter: 'h', href: '/', labelKey: 'home_nav' },
    { letter: 'p', href: '/people', labelKey: 'people' },
    { letter: 'f', href: '/families', labelKey: 'families' },
    { letter: 't', href: '/tree', labelKey: 'tree' },
    { letter: 'm', href: '/places', labelKey: 'places' },
    { letter: 'l', href: '/library', labelKey: 'library' },
    { letter: 'r', href: '/cases', labelKey: 'research' },
    { letter: 'c', href: '/relationship', labelKey: 'relationship_trace' },
    { letter: 'i', href: '/import-export', labelKey: 'import_export' },
    { letter: 'd', href: '/data-checks', labelKey: 'data_checks' },
    { letter: 'a', href: '/audit', labelKey: 'audit_log' },
    { letter: 'o', href: '/options', labelKey: 'options_nav' },
];

/** What `n` then a letter creates. `labelKey` is in the `shortcuts` namespace. */
export type CreateAction = 'person' | 'family' | 'source';
export interface CreateShortcut { letter: string; action: CreateAction; labelKey: string; hintKey: string }

export const CREATE_SHORTCUTS: readonly CreateShortcut[] = [
    { letter: 'p', action: 'person', labelKey: 'new_person', hintKey: 'hint_person' },
    { letter: 'f', action: 'family', labelKey: 'new_family', hintKey: 'hint_family' },
    { letter: 's', action: 'source', labelKey: 'new_source', hintKey: 'hint_source' },
];

export type SequencePrefix = 'g' | 'n';

/** One key in a shortcut as the cheatsheet shows it; `mod` is Ctrl, or ⌘ on a Mac. */
export type KeyToken = { key: string } | { sep: 'then' | 'or' | 'plus' };

/** One cheatsheet row: its label key (in `shortcuts`, or `nav` for Go to) and keys. */
interface CheatRow { id: string; labelKey: string; labelNs: 'shortcuts' | 'nav'; keys: KeyToken[]; letters?: boolean }
export interface CheatGroup { id: 'go' | 'create' | 'anywhere' | 'editing' | 'photo'; titleKey: string; rows: CheatRow[] }

const K = (key: string): KeyToken => ({ key });
const THEN: KeyToken = { sep: 'then' };
const OR: KeyToken = { sep: 'or' };
const PLUS: KeyToken = { sep: 'plus' };

/** The cheatsheet, in its two columns: Go to on the left, the rest on the right. */
export function cheatsheet(mac: boolean): CheatGroup[] {
    const mod = mac ? '⌘' : 'Ctrl';
    const alt = mac ? '⌥' : 'Alt';
    return [
        {
            id: 'go', titleKey: 'group_go',
            rows: GO_SHORTCUTS.map((g) => ({ id: `go-${g.letter}`, labelKey: g.labelKey, labelNs: 'nav', keys: [K('g'), THEN, K(g.letter)], letters: true })),
        },
        {
            id: 'create', titleKey: 'group_create',
            rows: CREATE_SHORTCUTS.map((c) => ({ id: `new-${c.letter}`, labelKey: c.labelKey, labelNs: 'shortcuts', keys: [K('n'), THEN, K(c.letter)], letters: true })),
        },
        {
            id: 'anywhere', titleKey: 'group_anywhere',
            rows: [
                { id: 'cheatsheet', labelKey: 'show_shortcuts', labelNs: 'shortcuts', keys: [K('?'), OR, K(mod), PLUS, K('/')] },
                { id: 'search', labelKey: 'search', labelNs: 'shortcuts', keys: [K(mod), PLUS, K('K'), OR, K('/')] },
                { id: 'escape', labelKey: 'close', labelNs: 'shortcuts', keys: [K('Esc')] },
            ],
        },
        {
            id: 'editing', titleKey: 'group_editing',
            rows: [
                { id: 'save', labelKey: 'save', labelNs: 'shortcuts', keys: [K(mod), PLUS, K('S')] },
                { id: 'post', labelKey: 'post', labelNs: 'shortcuts', keys: [K(mod), PLUS, K('Enter')] },
                { id: 'suggestion', labelKey: 'suggestion', labelNs: 'shortcuts', keys: [K(alt), PLUS, K('1–9')] },
            ],
        },
        {
            id: 'photo', titleKey: 'group_photo',
            rows: [
                { id: 'photo-move', labelKey: 'photo_move', labelNs: 'shortcuts', keys: [K('←'), K('→')] },
                { id: 'photo-tags', labelKey: 'photo_tags', labelNs: 'shortcuts', keys: [K('t')], letters: true },
                { id: 'photo-zoom', labelKey: 'photo_zoom', labelNs: 'shortcuts', keys: [K('+'), K('−'), K('0')], letters: true },
            ],
        },
    ];
}

/** The letter a `KeyX` code names ("KeyP" → "p"), or null for any other key. */
export function letterOf(code: string): string | null {
    return /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : null;
}

/** `/` for search: the physical slash key with no modifier, or a layout's own `/`. */
export function isSearchSlash(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    return (e.code === 'Slash' && !e.shiftKey) || e.key === '/';
}

/** True when a key event comes from typing in a field, where no shortcut fires. */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return target.closest('[role="combobox"], [role="textbox"], [contenteditable="true"]') != null;
}

/** True on macOS (and iPadOS), where the cheatsheet shows ⌘ for Ctrl. */
export function isMacPlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

const LETTERS_KEY = 'letterShortcuts';
export const LETTER_SHORTCUTS_EVENT = 'heirloom:letter-shortcuts';

/** Whether character shortcuts are on (Options › Keyboard; on unless turned off). Stored per device. */
export function readLetterShortcuts(): boolean {
    try {
        return localStorage.getItem(LETTERS_KEY) !== 'false';
    } catch {
        return true;
    }
}

export function writeLetterShortcuts(on: boolean): void {
    try {
        localStorage.setItem(LETTERS_KEY, String(on));
    } catch {
        // Storage unavailable: the event below still applies for this page view.
    }
    window.dispatchEvent(new CustomEvent<boolean>(LETTER_SHORTCUTS_EVENT, { detail: on }));
}

/** Asks the shortcuts host to open the cheatsheet (the user menu row, the Options button). */
export const OPEN_CHEATSHEET_EVENT = 'heirloom:open-shortcuts';
export function openCheatsheet(): void {
    window.dispatchEvent(new Event(OPEN_CHEATSHEET_EVENT));
}
