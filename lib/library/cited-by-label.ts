/**
 * cited-by-label.ts
 *
 * Pure helper — no I/O, no React, no i18n.
 *
 * Maps a CitedByRow to the parts of a "What this source proves" row: the fact
 * kind (which the caller labels, from `t('library.kind_<kind>')` or, for an
 * event, from its type) and who or what the fact is about (#755).
 *
 * Kind tokens: 'birth', 'death', 'name', 'person' (whole-person), 'event',
 * 'namevariant', 'family', 'case', and 'unknown' for an unrecognised table.
 */

import type { CitedByRow } from '@/lib/db/queries/citations';

export interface CitedByLabelResult {
    /** Kind token — the caller turns it into the row's label. */
    kind: string;
    /** Who or what the fact is about: a person's full name, both partners, or a case title. */
    subject: string;
    /** Secondary text: the alias itself on a name-variant row. */
    detail: string;
    /** The event's raw date, for the caller to format; '' when none. */
    date: string;
    /** Navigation href. Empty string when the row has no linked entity. */
    href: string;
}

function partnersOf(row: CitedByRow): string {
    return [row.familyPartner1Name, row.familyPartner2Name]
        .filter((n): n is string => !!n && n.trim() !== '')
        .join(' & ');
}

/** Returns the structured parts of a cited-by row. */
export function citedByLabel(row: CitedByRow): CitedByLabelResult {
    const peopleHref = row.personId != null ? `/people/view?id=${row.personId}` : '';
    const familyHref = row.familyId != null ? `/families/view?id=${row.familyId}` : '';
    const base = { subject: row.personName ?? '?', detail: '', date: '', href: peopleHref };

    switch (row.factTable) {
        case 'PersonBirth': return { ...base, kind: 'birth' };
        case 'PersonDeath': return { ...base, kind: 'death' };
        case 'PersonName': return { ...base, kind: 'name' };
        case 'People': return { ...base, kind: 'person' };
        case 'NameVariant': return { ...base, kind: 'namevariant', detail: row.variantName ?? '' };

        case 'Events':
            // A person's event names the person; a family event names the partners.
            return row.personId != null
                ? { ...base, kind: 'event', date: row.eventDate ?? '' }
                : { kind: 'event', subject: partnersOf(row) || '?', detail: '', date: row.eventDate ?? '', href: familyHref };

        case 'Families':
        case 'FamilyMarriage':
            // Named by its partners, as the rest of the app does; a family with
            // one recorded partner reads as just them.
            return { kind: 'family', subject: partnersOf(row) || '?', detail: '', date: '', href: familyHref };

        case 'Cases':
        case 'CaseComments':
            return {
                kind: 'case',
                subject: row.caseTitle ?? '?',
                detail: '',
                date: '',
                href: row.caseId != null ? `/cases/view?id=${row.caseId}` : '',
            };

        default:
            // Any future FactTableValue not yet handled.
            return { kind: 'unknown', subject: `${row.factTable} ${row.factId}`, detail: '', date: '', href: '' };
    }
}
