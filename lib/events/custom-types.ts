/**
 * Custom event types (#162): an event whose `Events."Type"` is not a GEDCOM tag the
 * app knows is a free-text label, shown exactly as typed in every language. It is
 * where an imported `1 EVEN` / `2 TYPE <label>` lands too (ADR 0012), and it exports
 * the same way. There is no catalogue: the labels already used in a tree are the list.
 */

/** Every tag the app records as an Events row, person or family, plus the marriage anchor. */
const STANDARD_EVENT_TYPES = new Set([
    // Person events (EVENT_TYPES in lib/db/schema.ts).
    'BIRT', 'DEAT', 'OCCU', 'EDUC', 'RESI', 'BURI', 'CHR', 'BAPM', 'ADOP', 'EVEN',
    'GRAD', 'EMIG', 'IMMI', 'NATU', 'CENS', 'RETI', 'PROB', 'WILL',
    // Family events (FAMILY_EVENT_TYPES in app/components/familyEventTypes.ts).
    'MARR', 'ENGA', 'MARB', 'MARC', 'MARL', 'MARS', 'DIV', 'DIVF', 'ANUL', 'SEPA',
]);

/** True when an event type is the user's own label rather than a known tag. */
export function isCustomEventType(type: string): boolean {
    return !STANDARD_EVENT_TYPES.has(type);
}

/** One event type and how many events in the tree use it. */
export interface EventTypeCount {
    type: string;
    count: number;
}

/**
 * The custom labels used in a tree, most used first, then by name: the "Used in
 * this tree" group of the type pickers.
 */
export function customEventTypes(counts: readonly EventTypeCount[]): EventTypeCount[] {
    return counts
        .filter((c) => c.type.trim() !== '' && isCustomEventType(c.type))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}
