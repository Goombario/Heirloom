/**
 * The coarse phases of a GEDCOM import, in order. The browser (PGlite) build
 * runs the whole import in the page, where a 5,000-person file takes about a
 * minute, so the service reports each phase as it starts and the import page
 * shows real progress instead of an unmoving bar (ST-1). Hosted imports are one
 * request and never report steps.
 *
 * A merge import has no separate `events` phase (events go in with their
 * people and families), so progress may skip a step; it never goes backwards.
 */
export const GEDCOM_IMPORT_STEPS = ['reading', 'sources', 'people', 'families', 'events', 'places'] as const;

export type GedcomImportStep = typeof GEDCOM_IMPORT_STEPS[number];
