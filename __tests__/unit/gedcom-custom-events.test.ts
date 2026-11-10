import { describe, it, expect } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { generateGedcom } from '@/lib/gedcom/generator';
import type { PersonWithRelations } from '@/lib/db/schema';

/**
 * ADR 0012 — "Custom events". GEDCOM 5.5.1's INDIVIDUAL_EVENT_STRUCTURE gives the
 * generic `EVEN` tag no inline value slot (unlike the family form): the event is
 * named by its subordinate `TYPE` line. `ged551-2.txt:490-508` states it outright
 * — "The event indicated by this general EVEN tag is defined by the value of the
 * subordinate TYPE tag" — with `1 EVEN` / `2 TYPE Land Lease` as the worked example.
 *
 * `processFamilyTag` has handled this since Phase 2; `processPersonTag` never did,
 * so the label was only ever preserved as opaque #423 passthrough and the event
 * showed up in the UI as a bare 'EVEN'. Fixing the import half alone is not enough:
 * the person-event *emit* path writes `1 ${evt.Type}` directly, so a structured
 * "Land Lease" would export as the malformed line `1 Land Lease`. Both halves —
 * and the passthrough set that stops the label being stored twice — are covered here.
 */

const SPEC_EXAMPLE = [
    '0 HEAD',
    '0 @I1@ INDI',
    '1 NAME John /Doe/',
    '1 EVEN',
    '2 TYPE Land Lease',
    '2 DATE 2 OCT 1837',
    '0 TRLR',
].join('\n');

describe('custom person events — import (ADR 0012)', () => {
    it('names the event from its subordinate TYPE line', () => {
        const { people } = parseGedcom(SPEC_EXAMPLE);
        expect(people[0].events).toHaveLength(1);
        expect(people[0].events[0].Type).toBe('Land Lease');
    });

    // Was '2 OCT 1837' — the raw GEDCOM value. #400 normalises event dates to ISO
    // like the promoted BIRT/DEAT/MARR columns already did, so this now asserts the
    // stored form rather than the wire form.
    it('still binds the event DATE alongside the TYPE label', () => {
        const { people } = parseGedcom(SPEC_EXAMPLE);
        expect(people[0].events[0].Date).toBe('1837-10-02');
    });

    it('does not ALSO capture TYPE as passthrough (would double-emit on export)', () => {
        const { people } = parseGedcom(SPEC_EXAMPLE);
        expect(people[0].events[0].rawLines).not.toContain('2 TYPE Land Lease');
    });

    // `TYPE` is NOT specific to `EVEN` — it is the first member of EVENT_DETAIL
    // (ged551-2.txt:359-361) and legal under every event: "The TYPE tag can be used
    // with each of the above tags used in this structure" (:448-449). So it only
    // NAMES the event for the generic `EVEN` form; under a standard tag it is an
    // unmodeled qualifier that must stay passthrough, or the event loses its identity.
    it('does not let TYPE overwrite a standard event tag', () => {
        const { people } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME John /Doe/',
            '1 BURI',
            '2 TYPE Cremation',
            '2 DATE 2 OCT 1837',
            '0 TRLR',
        ].join('\n'));
        expect(people[0].events[0].Type).toBe('BURI');
    });

    it('keeps a standard event TYPE as passthrough so it still round-trips', () => {
        const { people } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME John /Doe/',
            '1 BURI',
            '2 TYPE Cremation',
            '0 TRLR',
        ].join('\n'));
        expect(people[0].events[0].rawLines).toContain('2 TYPE Cremation');
    });

    it('leaves a standard event tag as its own type', () => {
        const { people } = parseGedcom([
            '0 HEAD',
            '0 @I1@ INDI',
            '1 NAME John /Doe/',
            '1 OCCU Blacksmith',
            '0 TRLR',
        ].join('\n'));
        expect(people[0].events[0].Type).toBe('OCCU');
        expect(people[0].events[0].Description).toBe('Blacksmith');
    });
});

/** Build a minimal person carrying one event, for the generator half. */
function personWithEvent(evt: { Type: string; Description?: string | null; Date?: string | null }): PersonWithRelations {
    return {
        Id: 1, FirstName: 'John', LastName: 'Doe', Sex: 'M',
        events: [{
            Id: 10, Type: evt.Type, Description: evt.Description ?? null,
            Date: evt.Date ?? null, Place: null, PersonId: 1, FamilyId: null,
        }],
    } as unknown as PersonWithRelations;
}

describe('custom person events — export (ADR 0012)', () => {
    it('emits a non-standard type as a generic EVEN named by TYPE', () => {
        const out = generateGedcom([personWithEvent({ Type: 'Land Lease' })], []);
        expect(out).toContain('1 EVEN');
        expect(out).toContain('2 TYPE Land Lease');
    });

    it('never emits a multi-word type as a bare tag (malformed GEDCOM)', () => {
        const out = generateGedcom([personWithEvent({ Type: 'Land Lease' })], []);
        expect(out).not.toContain('1 Land Lease');
    });

    it('emits a standard event tag directly, with no redundant TYPE line', () => {
        const out = generateGedcom([personWithEvent({ Type: 'OCCU', Description: 'Blacksmith' })], []);
        expect(out).toContain('1 OCCU Blacksmith');
        expect(out).not.toContain('2 TYPE OCCU');
    });
});

describe('custom person events — round trip (ADR 0012)', () => {
    it('preserves the custom label across import → export → import', () => {
        const first = parseGedcom(SPEC_EXAMPLE).people[0];

        const out = generateGedcom([personWithEvent({
            Type: first.events[0].Type,
            Date: first.events[0].Date,
        })], []);

        const second = parseGedcom(out).people[0];
        expect(second.events).toHaveLength(1);
        expect(second.events[0].Type).toBe('Land Lease');
        // Stable across the trip now, rather than alternating ISO ↔ raw GEDCOM: the
        // stored form is ISO on both passes (#400), so this equals `first`'s date.
        expect(second.events[0].Date).toBe('1837-10-02');
        expect(second.events[0].Date).toBe(first.events[0].Date);
    });

    it('emits the label exactly once', () => {
        const out = generateGedcom([personWithEvent({ Type: 'Land Lease' })], []);
        expect(out.split('\n').filter((l) => l.includes('Land Lease'))).toHaveLength(1);
    });
});

/**
 * The family path carried the same defect BEFORE this change (`HANDLED_FAMILY_EVENT_L2`
 * has always listed TYPE, and processFamilyTag's case has always been unguarded), so
 * "mirror the family side" would have mirrored a bug. Fixed symmetrically.
 */
describe('custom family events — TYPE only names a generic EVEN', () => {
    it('does not let TYPE overwrite a standard family event tag', () => {
        const { families } = parseGedcom([
            '0 HEAD',
            '0 @F1@ FAM',
            '1 DIV',
            '2 TYPE Civil',
            '0 TRLR',
        ].join('\n'));
        expect(families[0].events[0].Type).toBe('DIV');
    });

    it('still names a generic family EVEN from its TYPE', () => {
        const { families } = parseGedcom([
            '0 HEAD',
            '0 @F1@ FAM',
            '1 EVEN',
            '2 TYPE Land Transfer',
            '0 TRLR',
        ].join('\n'));
        expect(families[0].events[0].Type).toBe('Land Transfer');
    });

    it('round-trips a standard family event with a TYPE qualifier', () => {
        const first = parseGedcom([
            '0 HEAD',
            '0 @F1@ FAM',
            '1 DIV',
            '2 TYPE Civil',
            '0 TRLR',
        ].join('\n'));
        expect(first.families[0].events[0].rawLines).toContain('2 TYPE Civil');
    });
});
