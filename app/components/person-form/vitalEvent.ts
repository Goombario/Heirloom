/**
 * Pure routing helpers for "Option A" vital-event persistence.
 *
 * Birth (`BIRT`) and death (`DEAT`) facts on a person are stored as COLUMNS on
 * the `People` row (`BirthDate/BirthPlace/DeathDate/DeathPlace`), never as
 * `Events` rows. These helpers decide when a save must take the person-column
 * path and build the corresponding patch. No React, no data-client imports —
 * kept pure so both `InlineEventEditor` and its unit tests can import them.
 */

/** The target an editor is saving against (mirrors InlineEventEditor's prop). */
export type EventTarget =
    | { kind: 'person'; personId: number }
    | { kind: 'family'; familyId: number };

/** Patch shape written to `client.people.update` for a vital-event save. */
export type VitalPatch =
    | { BirthDate: string | null; BirthPlace: string | null }
    | { DeathDate: string | null; DeathPlace: string | null; DeathCause?: string | null; IsDeceased: 1 };

/** Patch shape that removes a vital fact from the person's columns. */
export type VitalDeletePatch =
    | { BirthDate: null; BirthPlace: null }
    | { DeathDate: null; DeathPlace: null; DeathCause: null; IsDeceased: null };

/**
 * True when a save should route to the person-column path instead of the
 * Events table: a `BIRT`/`DEAT` type on a `person` target. A type predicate so
 * a `true` result narrows `target` to the person branch at the call site.
 */
export function isVitalPersonType(
    target: EventTarget,
    type: string,
): target is Extract<EventTarget, { kind: 'person' }> {
    return target.kind === 'person' && (type === 'BIRT' || type === 'DEAT');
}

/**
 * Build the person-column patch for a vital event. A `DEAT` save also flips
 * `IsDeceased` to `1` — the numeric value the update service accepts (it maps
 * anything not strictly `1`/`0` to `null`; `usePersonForm` submits the same
 * coerced number) — and carries the cause of death (`2 CAUS`, #480).
 *
 * Empty/whitespace-only date, place and cause are normalized to `null` so a
 * blank vital save can never write an empty string `''` into a column (the
 * columns stay clean/nullable, matching how the Events path does
 * `Date: date || null`).
 *
 * `cause` distinguishes ABSENT from EMPTY, and the difference is data-loss
 * shaped. `undefined` means "this editor never showed a Cause input, so it has
 * nothing to say about the cause" — the `DeathCause` key is omitted from the
 * patch entirely and the stored column is left untouched. Any string, including
 * `''`, is a deliberate statement by a rendered input, so it writes
 * `cause.trim() || null` and an explicit clear stays a clear. Collapsing the two
 * would let the plain "Add event → Death" flow (no Cause field on screen)
 * silently destroy a cause entered on the person form.
 */
export function vitalPatchFor(type: string, date: string, place: string, cause?: string): VitalPatch {
    const d = date.trim() || null;
    const p = place.trim() || null;
    if (type === 'DEAT') {
        return {
            DeathDate: d,
            DeathPlace: p,
            ...(cause === undefined ? {} : { DeathCause: cause.trim() || null }),
            IsDeceased: 1,
        };
    }
    return { BirthDate: d, BirthPlace: p };
}

/**
 * Build the patch that removes a vital fact. Every column belonging to that
 * fact must be nulled together.
 *
 * `DeathCause` in particular is load-bearing rather than tidy: `generator.ts`
 * emits a `1 DEAT` block when `DeathCause` is set, even with no date or place,
 * so a cause left behind by a delete would resurrect — on the very next export
 * — the death record the user had just removed.
 */
export function vitalDeletePatchFor(type: 'BIRT' | 'DEAT'): VitalDeletePatch {
    if (type === 'DEAT') {
        return { DeathDate: null, DeathPlace: null, DeathCause: null, IsDeceased: null };
    }
    return { BirthDate: null, BirthPlace: null };
}

interface DeathDetails {
    DeathDate?: string | null;
    DeathPlace?: string | null;
    DeathCause?: string | null;
}

/**
 * True when saving this living status would leave death details behind (#895).
 * A death date, place or cause outranks the flag everywhere the status shows, so
 * Living or Unknown with any of them kept would still read as deceased. Callers
 * confirm, then save `DEATH_DETAILS_CLEARED` with the status.
 */
export function statusDropsDeath(isDeceased: number | null, death: DeathDetails): boolean {
    return isDeceased !== 1 && Boolean(death.DeathDate?.trim() || death.DeathPlace?.trim() || death.DeathCause?.trim());
}

/** The death columns a confirmed Living or Unknown save clears. The status itself is the caller's. */
export const DEATH_DETAILS_CLEARED = { DeathDate: null, DeathPlace: null, DeathCause: null } as const;
