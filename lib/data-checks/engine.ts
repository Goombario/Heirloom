/**
 * The data checks engine (#786, #828): a tree's people, events and families in,
 * problems out.
 *
 * Checks are computed on demand and never stored; only confirmations are
 * (#830). If this gets slow, make it faster here. Don't add stored results or
 * a "Check again" button (#786, "Consequences").
 *
 * Every rule compares date intervals (`lib/date-intervals.ts`) and flags only
 * when EVERY reading conflicts, so an approximate date raises no false alarm.
 * When a birth or death date is missing, a baptism or burial stands in as a
 * bound: birth is no later than baptism, and death no later than burial.
 *
 * Pure: no DB, no DOM. The server and the static build's PGlite both call it.
 */

import { FACT_TABLES } from '@/lib/db/fact-tables';
import { isDatePhrase } from '@/lib/date-qualifiers';
import { addMonths, addYears, dateInterval, daysFromCivil, type DateInterval } from '@/lib/date-intervals';
import {
    DATA_CHECK_RULES, RULE_KIND, FATHER_DEATH_MONTHS, DIED_YOUNG_MAX_AGE, UNLIKELY_THRESHOLDS, ruleThreshold,
    type DataCheckFact, type DataCheckFactTable, type DataCheckInput, type DataCheckPerson,
    type DataCheckProblem, type DataCheckRuleId,
} from './rules';

interface Dated {
    fact: DataCheckFact;
    iv: DateInterval;
}

/** One person's checkable dates, each parsed once. */
interface Life {
    person: DataCheckPerson;
    sex: 'F' | 'M' | null;
    /** The stored birth date. */
    birth: Dated | null;
    /** The stored death date. */
    death: Dated | null;
    /** The birth date, else the earliest baptism as an upper bound on it. */
    birthUpper: Dated | null;
    /** The death date, else the earliest burial or cremation as an upper bound on it. */
    deathUpper: Dated | null;
    /** The person's own dated events, excluding alternative BIRT/DEAT records. */
    events: Dated[];
}

const BAPTISM_TYPES = new Set(['BAPM', 'CHR']);
const DISPOSAL_TYPES = new Set(['BURI', 'CREM']);
/** Facts that normally follow a death (#786): never "after death". */
const AFTER_DEATH_EXEMPT = new Set(['BURI', 'CREM', 'PROB', 'WILL', 'OBIT']);
/** Explicit partnership end events, as `FamilyTimeline` reads them. */
const PARTNERSHIP_END_TYPES = new Set(['DIV', 'DIVF', 'ANUL', 'SEPA']);
/** A BIRT or DEAT event is another record of the vital itself, not an event in the life. */
const VITAL_TYPES = new Set(['BIRT', 'DEAT']);
/**
 * The GEDCOM individual events and attributes that belong to a lifetime, so
 * they are checked against the birth and death (rules 4 and 5). A generic EVEN
 * or FACT, a custom `_TAG` and an EVEN's own label are left out: vendor trees
 * use them for records and mentions ("genannt" 2004, "Alt. Burial") that are
 * dated outside the life, and 7 of 10 such hits on real exports were not
 * mistakes (#869). LDS ordinances are left out too: they are often by proxy.
 */
const LIFE_EVENT_TYPES = new Set([
    'BIRT', 'CHR', 'DEAT', 'BURI', 'CREM', 'ADOP', 'BAPM', 'BARM', 'BASM', 'BLES', 'CHRA', 'CONF', 'FCOM',
    'ORDN', 'NATU', 'EMIG', 'IMMI', 'CENS', 'PROB', 'WILL', 'GRAD', 'RETI',
    'CAST', 'DSCR', 'EDUC', 'IDNO', 'NATI', 'NCHI', 'NMR', 'OCCU', 'PROP', 'RELI', 'RESI', 'SSN', 'TITL',
]);

const RULE_ORDER = new Map<DataCheckRuleId, number>(DATA_CHECK_RULES.map((r, i) => [r.id, i]));

function makeFact(table: DataCheckFactTable, id: number, type: string, personId: number | null, familyId: number | null, date: string): DataCheckFact {
    return { key: `${table}:${id}`, table, id, type, personId, familyId, date };
}

function dated(fact: DataCheckFact): Dated | null {
    const iv = dateInterval(fact.date);
    return iv && { fact, iv };
}

/** A stand-in bound: open at the start, ending where `d` ends. */
function upperBound(d: Dated): Dated {
    return { fact: d.fact, iv: { earliest: -Infinity, latest: d.iv.latest } };
}

/** The event with the earliest possible end, which bounds the vital most tightly. */
function tightest(events: Dated[], types: Set<string>): Dated | null {
    let best: Dated | null = null;
    for (const e of events) {
        if (types.has(e.fact.type) && (!best || e.iv.latest < best.iv.latest)) best = e;
    }
    return best;
}

function sexOf(sex: string | null): 'F' | 'M' | null {
    const s = sex?.trim().charAt(0).toUpperCase();
    return s === 'F' || s === 'M' ? s : null;
}

interface Draft {
    rule: DataCheckRuleId;
    personId: number;
    related: Set<number>;
    families: Set<number>;
    facts: Map<string, DataCheckFact>;
    editable: Set<string>;
}

/** Gathers findings into one entry per person per rule. */
class Problems {
    private drafts = new Map<string, Draft>();
    /** Person → the fact keys their impossible problems mark editable. */
    private impossibleEditable = new Map<number, Set<string>>();

    add(rule: DataCheckRuleId, personId: number, parts: {
        related?: Array<number | null | undefined>;
        families?: number[];
        facts: Array<Dated | DataCheckFact>;
        editable: Array<Dated | DataCheckFact>;
    }): void {
        const id = `${rule}:${personId}`;
        let d = this.drafts.get(id);
        if (!d) {
            d = { rule, personId, related: new Set(), families: new Set(), facts: new Map(), editable: new Set() };
            this.drafts.set(id, d);
        }
        for (const r of parts.related ?? []) if (r != null && r !== personId) d.related.add(r);
        for (const f of parts.families ?? []) d.families.add(f);
        const factOf = (f: Dated | DataCheckFact) => ('iv' in f ? f.fact : f);
        for (const f of parts.facts) d.facts.set(factOf(f).key, factOf(f));
        for (const f of parts.editable) d.editable.add(factOf(f).key);
        if (RULE_KIND[rule] === 'impossible') {
            let keys = this.impossibleEditable.get(personId);
            if (!keys) this.impossibleEditable.set(personId, keys = new Set());
            for (const f of parts.editable) keys.add(factOf(f).key);
        }
    }

    /** Whether an impossible problem already listed under `personId` marks `fact` as the date to fix. */
    marksImpossible(personId: number, fact: Dated): boolean {
        return this.impossibleEditable.get(personId)?.has(fact.fact.key) ?? false;
    }

    list(): DataCheckProblem[] {
        return [...this.drafts.values()]
            .sort((a, b) => RULE_ORDER.get(a.rule)! - RULE_ORDER.get(b.rule)! || a.personId - b.personId)
            .map((d) => ({
                id: `${d.rule}:${d.personId}`,
                rule: d.rule,
                kind: RULE_KIND[d.rule],
                threshold: ruleThreshold(d.rule),
                personId: d.personId,
                relatedPersonIds: [...d.related].sort((a, b) => a - b),
                familyIds: [...d.families].sort((a, b) => a - b),
                facts: [...d.facts.values()],
                editable: [...d.editable],
            }));
    }
}

function buildLives(input: DataCheckInput): Map<number, Life> {
    const eventsByPerson = new Map<number, Dated[]>();
    for (const e of input.events) {
        if (e.PersonId == null || !e.Date || VITAL_TYPES.has(e.Type)) continue;
        const d = dated(makeFact(FACT_TABLES.EVENTS, e.Id, e.Type, e.PersonId, e.FamilyId, e.Date));
        if (!d) continue;
        const list = eventsByPerson.get(e.PersonId);
        if (list) list.push(d); else eventsByPerson.set(e.PersonId, [d]);
    }

    const lives = new Map<number, Life>();
    for (const p of input.people) {
        const events = eventsByPerson.get(p.Id) ?? [];
        const birth = p.BirthDate ? dated(makeFact(FACT_TABLES.PERSON_BIRTH, p.Id, 'BIRT', p.Id, null, p.BirthDate)) : null;
        const death = p.DeathDate ? dated(makeFact(FACT_TABLES.PERSON_DEATH, p.Id, 'DEAT', p.Id, null, p.DeathDate)) : null;
        const baptism = birth ? null : tightest(events, BAPTISM_TYPES);
        const disposal = death ? null : tightest(events, DISPOSAL_TYPES);
        lives.set(p.Id, {
            person: p,
            sex: sexOf(p.Sex),
            birth,
            death,
            birthUpper: birth ?? (baptism && upperBound(baptism)),
            deathUpper: death ?? (disposal && upperBound(disposal)),
            events,
        });
    }
    return lives;
}

/** Strongly connected components of size > 1, or with a self-edge (Tarjan, iterative). */
function cycles(adj: Map<number, number[]>): number[][] {
    let next = 0;
    const index = new Map<number, number>();
    const low = new Map<number, number>();
    const onStack = new Set<number>();
    const stack: number[] = [];
    const out: number[][] = [];
    const visit = (v: number) => {
        index.set(v, next);
        low.set(v, next);
        next++;
        stack.push(v);
        onStack.add(v);
    };

    for (const root of adj.keys()) {
        if (index.has(root)) continue;
        visit(root);
        const work: Array<[number, number]> = [[root, 0]];
        while (work.length) {
            const top = work[work.length - 1];
            const v = top[0];
            const edges = adj.get(v) ?? [];
            if (top[1] < edges.length) {
                const w = edges[top[1]++];
                if (!index.has(w)) {
                    visit(w);
                    work.push([w, 0]);
                } else if (onStack.has(w)) {
                    low.set(v, Math.min(low.get(v)!, index.get(w)!));
                }
                continue;
            }
            work.pop();
            if (work.length) {
                const u = work[work.length - 1][0];
                low.set(u, Math.min(low.get(u)!, low.get(v)!));
            }
            if (low.get(v) === index.get(v)) {
                const comp: number[] = [];
                let w: number;
                do {
                    w = stack.pop()!;
                    onStack.delete(w);
                    comp.push(w);
                } while (w !== v);
                if (comp.length > 1 || edges.includes(v)) out.push(comp);
            }
        }
    }
    return out;
}

/**
 * Record shape: a stored date that is neither a date the checks can read nor
 * a GEDCOM date phrase. Phrases are prose by design and are skipped. Listed
 * under the person the date belongs to; a family's dates go to its first
 * partner.
 */
function flagUnreadable(input: DataCheckInput, problems: Problems): void {
    const unreadable = (date: string | null): date is string =>
        Boolean(date?.trim()) && dateInterval(date) === null && !isDatePhrase(date);
    const firstPartner = new Map(input.families.map((f) => [f.Id, f.Partner1Id ?? f.Partner2Id]));
    const flag = (owner: number | null | undefined, fact: DataCheckFact) => {
        if (owner != null) problems.add('unreadable_date', owner, { families: fact.familyId != null ? [fact.familyId] : [], facts: [fact], editable: [fact] });
    };

    for (const p of input.people) {
        if (unreadable(p.BirthDate)) flag(p.Id, makeFact(FACT_TABLES.PERSON_BIRTH, p.Id, 'BIRT', p.Id, null, p.BirthDate));
        if (unreadable(p.DeathDate)) flag(p.Id, makeFact(FACT_TABLES.PERSON_DEATH, p.Id, 'DEAT', p.Id, null, p.DeathDate));
    }
    for (const f of input.families) {
        if (unreadable(f.MarriageDate)) flag(firstPartner.get(f.Id), makeFact(FACT_TABLES.FAMILIES, f.Id, 'MARR', null, f.Id, f.MarriageDate));
    }
    for (const e of input.events) {
        if (!unreadable(e.Date)) continue;
        const owner = e.PersonId ?? (e.FamilyId != null ? firstPartner.get(e.FamilyId) : null);
        flag(owner, makeFact(FACT_TABLES.EVENTS, e.Id, e.Type, e.PersonId, e.FamilyId, e.Date));
    }
}

function todayDay(): number {
    const now = new Date();
    return daysFromCivil(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}

export interface DataCheckOptions {
    /** Today as a day number (`daysFromCivil`), for "marked living but over 110". Defaults to the current UTC date. */
    today?: number;
}

export function runDataChecks(input: DataCheckInput, options: DataCheckOptions = {}): DataCheckProblem[] {
    const today = options.today ?? todayDay();
    const lives = buildLives(input);
    const problems = new Problems();

    const familyEvents = new Map<number, Dated[]>();
    for (const e of input.events) {
        if (e.FamilyId == null || !e.Date || !PARTNERSHIP_END_TYPES.has(e.Type)) continue;
        const d = dated(makeFact(FACT_TABLES.EVENTS, e.Id, e.Type, e.PersonId, e.FamilyId, e.Date));
        if (!d) continue;
        const list = familyEvents.get(e.FamilyId);
        if (list) list.push(d); else familyEvents.set(e.FamilyId, [d]);
    }

    // Who each person is tied to, for "died aged 8 or younger but has children":
    // the co-parent and the children of each family that has children (#970).
    const ties = new Map<number, { people: Set<number>; families: Set<number> }>();
    const tie = (personId: number, other: number | null, familyId: number) => {
        let t = ties.get(personId);
        if (!t) ties.set(personId, (t = { people: new Set(), families: new Set() }));
        if (other != null) t.people.add(other);
        t.families.add(familyId);
    };

    // Child → parents, for "person is their own ancestor".
    const parentsOf = new Map<number, number[]>();

    for (const f of input.families) {
        const start = f.MarriageDate
            ? dated(makeFact(FACT_TABLES.FAMILIES, f.Id, 'MARR', null, f.Id, f.MarriageDate))
            : null;
        const partnerIds = [f.Partner1Id, f.Partner2Id].filter((id): id is number => id != null);
        const partners = partnerIds.map((id) => lives.get(id)).filter((l): l is Life => Boolean(l));

        for (const c of f.childIds) {
            const list = parentsOf.get(c);
            if (list) list.push(...partnerIds); else parentsOf.set(c, [...partnerIds]);
        }

        // 6. Partnership ends before it starts. Explicit end events only: a
        //    derived end is never stored data (#826). Listed under the first partner.
        if (start && partners.length) {
            for (const end of familyEvents.get(f.Id) ?? []) {
                if (end.iv.latest < start.iv.earliest) {
                    problems.add('partnership_ends_before_start', partners[0].person.Id, {
                        related: partnerIds, families: [f.Id], facts: [start, end], editable: [end],
                    });
                }
            }
        }

        for (const partner of partners) {
            const id = partner.person.Id;
            const other = partnerIds.find((x) => x !== id) ?? null;
            if (f.childIds.length) tie(id, other, f.Id);
            for (const c of f.childIds) tie(id, c, f.Id);

            if (start) {
                // 10. Partnership starts after a partner's death.
                if (partner.deathUpper && start.iv.earliest > partner.deathUpper.iv.latest) {
                    problems.add('partnership_after_death', id, {
                        related: [other], families: [f.Id], facts: [partner.deathUpper, start], editable: [partner.deathUpper],
                    });
                }
                // 11. Partnership starts before a partner's birth; else, unlikely,
                //     a partner under 12 when it starts.
                if (partner.birth && start.iv.latest < partner.birth.iv.earliest) {
                    problems.add('partnership_before_birth', id, {
                        related: [other], families: [f.Id], facts: [partner.birth, start], editable: [partner.birth],
                    });
                } else if (partner.birth && start.iv.latest < addYears(partner.birth.iv.earliest, UNLIKELY_THRESHOLDS.married_too_young)) {
                    problems.add('married_too_young', id, {
                        related: [other], families: [f.Id], facts: [partner.birth, start], editable: [partner.birth],
                    });
                }
            }

            // Two partners of the same sex: either could be the birth parent, so
            // neither's death bounds the birth the way a mother's does.
            const otherSex = other != null ? lives.get(other)?.sex ?? null : null;
            const sameSex = partner.sex !== null && partner.sex === otherSex;
            // Per partner (#982): a stepchild is one partner's birth child.
            const nonBirth = new Set((id === f.Partner1Id ? f.partner1NonBirthChildIds : f.partner2NonBirthChildIds) ?? []);

            for (const childId of f.childIds) {
                const child = lives.get(childId);
                if (!child || childId === id) continue;

                // The age and sex rules hold for birth links only: an adoptive,
                // foster or step-parent can be any age. The death rules below hold
                // for every link, since nobody adopts, fosters or becomes a step-parent after death.
                if (!nonBirth.has(childId)) {
                    // 7. Child born before a parent. Listed under the parent, whose
                    //    birth is the date to fix: one wrong birth moves every child.
                    if (child.birthUpper && partner.birth && child.birthUpper.iv.latest < partner.birth.iv.earliest) {
                        problems.add('child_born_before_parent', id, {
                            related: [childId], families: [f.Id], facts: [partner.birth, child.birthUpper], editable: [partner.birth],
                        });
                    // Unlikely: a parent under 12 at the child's birth.
                    } else if (child.birthUpper && partner.birth
                        && child.birthUpper.iv.latest < addYears(partner.birth.iv.earliest, UNLIKELY_THRESHOLDS.parent_too_young)) {
                        problems.add('parent_too_young', id, {
                            related: [childId], families: [f.Id], facts: [partner.birth, child.birthUpper], editable: [partner.birth],
                        });
                    }

                    // Unlikely: a mother over 55 at the child's birth. "Over 55"
                    // is 56 or older on every reading, so exactly 55 isn't flagged.
                    if (partner.sex === 'F' && !sameSex && partner.birthUpper && child.birth
                        && child.birth.iv.earliest >= addYears(partner.birthUpper.iv.latest, UNLIKELY_THRESHOLDS.mother_too_old + 1)) {
                        problems.add('mother_too_old', id, {
                            related: [childId], families: [f.Id], facts: [partner.birthUpper, child.birth], editable: [partner.birthUpper],
                        });
                    }
                }

                // 8 and 9. Child born after the mother's death, or more than
                //    10 months after the father's. A parent of unknown sex, or
                //    either partner of a same-sex couple, gets the father's
                //    allowance: it's the one that holds for either.
                if (!child.birth || !partner.deathUpper) continue;
                const mother = partner.sex === 'F' && !sameSex;
                const limit = mother ? partner.deathUpper.iv.latest : addMonths(partner.deathUpper.iv.latest, FATHER_DEATH_MONTHS);
                if (child.birth.iv.earliest > limit) {
                    problems.add(mother ? 'child_born_after_mother_death' : 'child_born_after_father_death', id, {
                        related: [childId], families: [f.Id], facts: [partner.deathUpper, child.birth], editable: [partner.deathUpper],
                    });
                }
            }
        }
    }

    for (const life of lives.values()) {
        const { person, birth, death, birthUpper, deathUpper, events } = life;
        const id = person.Id;
        // Facts an earlier rule already reported for this person, so the
        // broader "event before birth" doesn't report them a second time.
        const reported = new Set<string>();

        // 1. Death before birth. Either date could be the mistake, so both are
        //    editable (decided 2026-09-26).
        const deathBeforeBirth = Boolean(birth && deathUpper && deathUpper.iv.latest < birth.iv.earliest);
        if (deathBeforeBirth) {
            problems.add('death_before_birth', id, { facts: [birth!, deathUpper!], editable: [birth!, deathUpper!] });
            reported.add(deathUpper!.fact.key);
        }

        // 2. Burial or cremation before death. The death date is the one to fix:
        //    the burial usually comes from a register, and follows within days.
        if (death) {
            for (const e of events) {
                if (DISPOSAL_TYPES.has(e.fact.type) && e.iv.latest < death.iv.earliest) {
                    problems.add('burial_before_death', id, { facts: [death, e], editable: [death] });
                    reported.add(e.fact.key);
                }
            }
        }

        if (birth) {
            for (const e of events) {
                if (!(e.iv.latest < birth.iv.earliest)) continue;
                // 3. Baptism or christening before birth.
                if (BAPTISM_TYPES.has(e.fact.type)) {
                    problems.add('baptism_before_birth', id, { facts: [birth, e], editable: [birth] });
                // 4. Any other life event before birth.
                } else if (LIFE_EVENT_TYPES.has(e.fact.type) && !reported.has(e.fact.key)) {
                    problems.add('event_before_birth', id, { facts: [birth, e], editable: [birth] });
                }
            }
        }

        // 5. Any life event after death, except those that normally follow one.
        if (deathUpper) {
            for (const e of events) {
                if (LIFE_EVENT_TYPES.has(e.fact.type) && !AFTER_DEATH_EXEMPT.has(e.fact.type) && e.iv.earliest > deathUpper.iv.latest) {
                    problems.add('event_after_death', id, { facts: [deathUpper, e], editable: [deathUpper] });
                }
            }
        }

        // 12. Died aged 8 or younger but has children. A partner alone isn't
        //     enough: historical trees record real child marriages (#970). Every
        //     reading of the age at death must be under 9. Not repeated when an
        //     impossible problem already marks this death as the date to fix,
        //     such as a death before the birth or before a child's birth.
        const t = ties.get(id);
        if (t && birth && deathUpper && !problems.marksImpossible(id, deathUpper)
            && deathUpper.iv.latest < addYears(birth.iv.earliest, DIED_YOUNG_MAX_AGE + 1)) {
            problems.add('died_young_with_family', id, {
                related: [...t.people], families: [...t.families], facts: [birth, deathUpper], editable: [deathUpper],
            });
        }

        // Unlikely: over 110 at death, on every reading. The birth is the date
        // to fix: a great age usually comes from a parent's birth copied over.
        if (death && birthUpper
            && death.iv.earliest >= addYears(birthUpper.iv.latest, UNLIKELY_THRESHOLDS.died_too_old + 1)) {
            problems.add('died_too_old', id, { facts: [birthUpper, death], editable: [birthUpper] });
        }

        // Unlikely: marked living, and over 110 today. The fix is the living
        // flag on the person's page, not a date, so nothing is editable here.
        if (person.IsDeceased === 0 && !person.DeathDate && birthUpper
            && today >= addYears(birthUpper.iv.latest, UNLIKELY_THRESHOLDS.living_too_old + 1)) {
            problems.add('living_too_old', id, { facts: [birthUpper], editable: [] });
        }
    }

    // 13. Person is their own ancestor: a cycle in the parent links. One entry
    //     per cycle, under its lowest ID. It isn't a date, so nothing is editable.
    for (const comp of cycles(parentsOf)) {
        const members = new Set(comp);
        const families = input.families
            .filter((f) => f.childIds.some((c) => members.has(c))
                && [f.Partner1Id, f.Partner2Id].some((p) => p != null && members.has(p)))
            .map((f) => f.Id);
        const owner = Math.min(...comp);
        problems.add('own_ancestor', owner, { related: comp, families, facts: [], editable: [] });
    }

    flagUnreadable(input, problems);
    return problems.list();
}
