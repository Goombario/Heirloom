'use client';

import { useId } from 'react';

/**
 * The token Chrome is asked to read. It is deliberately NOT `off`.
 *
 * Chromium ignores `autocomplete="off"` for the field types its address autofill
 * covers — that decision is a decade old and explicitly won't-fix
 * (crbug.com/914451). What it does honour is an *unrecognised* token: any value
 * other than a spec token (and other than `on`) turns the autofill heuristics off
 * for that field in Blink, and Firefox and Safari treat an unknown token as `off`
 * too, so one attribute covers every engine.
 *
 * Verified against a real Chrome profile with a saved address on the actual person
 * form: with `off` the Last name and both Place fields offered the address; with
 * this token all three went silent, nothing else changed.
 */
const UNRECOGNISED_TOKEN = 'chrome-off';

/**
 * Props that suppress the BROWSER's own autofill on a field that asks about
 * someone else (#442).
 *
 * Every person/place field in this app is about a historical relative, never
 * about the user, so Chrome's saved-address suggestions are always wrong here —
 * and they render on top of the app's own typeahead, hiding the suggestions that
 * ARE right.
 *
 * Two levers, because Chrome uses two signals:
 *  - The `autocomplete` token above, which is what actually stops the dropdown.
 *  - A `name` Chrome's classifier cannot recognise. Its heuristics read the
 *    field's name/id (and the visible label and placeholder) to decide a field is
 *    an address; `useId()` gives a value that is unique per mount and identical
 *    between the server and client render, so hydration still matches.
 *
 * The `data-*` attributes are the opt-outs published by the password managers
 * that inject their own overlay (LastPass, 1Password, Dashlane); inert elsewhere.
 *
 * **Not an accessibility regression.** WCAG 1.3.5 (Identify Input Purpose) applies
 * only to inputs collecting information about *the user*. These collect facts
 * about a third party — a relative, usually long dead — which the criterion
 * explicitly excludes, so no spec token is owed here in the first place.
 *
 * Usage: `const noAutofill = useNoAutofill();` then `<input {...noAutofill('first-name')} />`.
 * Spread it BEFORE any explicit `name`/`autoComplete` a caller genuinely needs.
 */
export function useNoAutofill() {
    const scope = useId();
    return (field: string) => ({
        autoComplete: UNRECOGNISED_TOKEN,
        name: `${scope}${field}`,
        'data-lpignore': 'true',
        'data-1p-ignore': '',
        'data-form-type': 'other',
    });
}
