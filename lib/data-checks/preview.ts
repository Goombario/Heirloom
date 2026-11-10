/**
 * "Does this date clear the problem?" (#832). The Data checks detail edits the
 * date to fix in place, and re-runs the engine in the browser as you type, on
 * just the dates that person's problems can depend on.
 *
 * Pure: no DB, no DOM.
 */

import { FACT_TABLES } from '@/lib/db/fact-tables';
import { runDataChecks, type DataCheckOptions } from './engine';
import type { DataCheckFact, DataCheckInput } from './rules';

/**
 * Everything a problem listed under `personId` can depend on: the person, the
 * families they're a partner in, those families' other partners and children,
 * and all of their events. Every rule is listed under the person whose date is
 * most likely wrong, and compares that person's own dates with their partners'
 * and children's, so this is enough to re-decide any of that person's problems.
 * "Own ancestor" needs the whole tree, but it isn't a date, so it's never edited.
 */
export function neighbourhood(input: DataCheckInput, personId: number): DataCheckInput {
    const families = input.families.filter((f) => f.Partner1Id === personId || f.Partner2Id === personId);
    const peopleIds = new Set<number>([personId]);
    for (const f of families) {
        if (f.Partner1Id != null) peopleIds.add(f.Partner1Id);
        if (f.Partner2Id != null) peopleIds.add(f.Partner2Id);
        for (const c of f.childIds) peopleIds.add(c);
    }
    const familyIds = new Set(families.map((f) => f.Id));
    return {
        people: input.people.filter((p) => peopleIds.has(p.Id)),
        events: input.events.filter((e) =>
            (e.PersonId != null && peopleIds.has(e.PersonId)) || (e.FamilyId != null && familyIds.has(e.FamilyId))),
        families,
    };
}

/** `input` with the date stored at `fact`'s address replaced by `date`. */
function withDate(input: DataCheckInput, fact: DataCheckFact, date: string): DataCheckInput {
    switch (fact.table) {
        case FACT_TABLES.PERSON_BIRTH:
            return { ...input, people: input.people.map((p) => (p.Id === fact.id ? { ...p, BirthDate: date } : p)) };
        case FACT_TABLES.PERSON_DEATH:
            return { ...input, people: input.people.map((p) => (p.Id === fact.id ? { ...p, DeathDate: date } : p)) };
        case FACT_TABLES.FAMILIES:
            return { ...input, families: input.families.map((f) => (f.Id === fact.id ? { ...f, MarriageDate: date } : f)) };
        case FACT_TABLES.EVENTS:
            return { ...input, events: input.events.map((e) => (e.Id === fact.id ? { ...e, Date: date } : e)) };
    }
}

/** True when storing `date` at `fact` makes the problem `problemId` go away. */
export function dateClearsProblem(
    input: DataCheckInput, problemId: string, fact: DataCheckFact, date: string, options?: DataCheckOptions,
): boolean {
    return !runDataChecks(withDate(input, fact, date), options).some((p) => p.id === problemId);
}
