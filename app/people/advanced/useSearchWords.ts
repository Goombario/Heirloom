'use client';

import { useTranslations } from 'next-intl';
import { familyEventLabel } from '@/app/components/familyEventTypes';
import { activeQuery, valueKind, type FieldId, type OpId, type SearchCondition, type SearchQuery } from '@/lib/search/people-query';

/** What a phrase needs to name a picked record. */
export interface RecordNames {
    person: (id: number) => string | null;
    source: (id: number) => string | null;
    caseTitle: (id: number) => string | null;
}

const HAS_PHRASE: Partial<Record<FieldId, string>> = {
    parents: 'parents', children: 'children', sources: 'sources', media: 'media', cases: 'cases', data_checks: 'data_checks', notes: 'notes',
};

/**
 * The plain words for advanced search (#247): field, condition and value labels,
 * and each condition as a phrase for the closed summary and the empty state.
 * Never a GEDCOM tag (#64 rule).
 */
export function useSearchWords() {
    const t = useTranslations('peopleSearch');
    const tTypes = useTranslations('eventTypes');
    const tEdit = useTranslations('eventEdit');
    const tChecks = useTranslations('dataChecks');

    const field = (f: FieldId) => t(`field_${f}`);
    const op = (o: OpId) => t(`op_${o}`);
    const eventType = (type: string) => (type === 'MARR' ? t('event_marriage') : tTypes.has(type) ? tTypes(type) : familyEventLabel(type, tEdit));
    const rule = (id: string) => (tChecks.has(`rule_${id}`) ? tChecks(`rule_${id}`) : id);
    const sex = (v: string) => t(`sex_${v}`);
    const living = (v: string) => t(`living_${v}`);

    /** The value as words: "1939 and 1945", "Female", "James Smith". */
    function value(c: SearchCondition, names: RecordNames): string {
        const kind = valueKind(c.field, c.op);
        const one = (v: string | undefined) => {
            const s = v?.trim() ?? '';
            if (kind === 'sex') return sex(s);
            if (kind === 'living') return living(s);
            if (kind === 'event_type') return eventType(s);
            if (kind === 'rule') return rule(s);
            return s;
        };
        if (kind === 'person') return names.person(c.id ?? 0) ?? t('someone');
        if (kind === 'source') return names.source(c.id ?? 0) ?? t('a_source');
        if (kind === 'case') return names.caseTitle(c.id ?? 0) ?? t('a_case');
        if (c.op === 'between') return t('value_between', { a: one(c.v), b: one(c.v2) });
        return one(c.v);
    }

    /** One condition as a phrase: "death date is between 1939 and 1945", "has no parents". */
    function phrase(c: SearchCondition, names: RecordNames): string {
        if (c.field === 'relationship') {
            const base = t(`sum_rel_${c.rel ?? 'related'}`, { name: value(c, names) });
            const blood = c.marriage === false ? t('sum_rel_blood', { phrase: base }) : base;
            return t('sum_rel_steps', { phrase: blood, steps: c.steps ?? 6 });
        }
        if (c.field === 'event_type') return t(c.op === 'has' ? 'sum_has_event' : 'sum_no_event', { type: value(c, names) });
        const has = HAS_PHRASE[c.field];
        if (has && (c.op === 'has' || c.op === 'has_none')) return t(c.op === 'has' ? `sum_has_${has}` : `sum_no_${has}`);
        const f = field(c.field).toLocaleLowerCase();
        const kind = valueKind(c.field, c.op);
        if (kind === 'none') return `${f} ${op(c.op)}`;
        // A choice reads as a word in the sentence ("sex is female"); a name or typed text keeps its case.
        const v = value(c, names);
        return `${f} ${op(c.op)} ${kind === 'sex' || kind === 'living' ? v.toLocaleLowerCase() : v}`;
    }

    /** The whole query as one line: "(a and b) or (c and d)". */
    function summary(q: SearchQuery, names: RecordNames): Array<{ text: string; joiner?: string; open?: boolean; close?: boolean }> {
        const active = activeQuery(q);
        const out: Array<{ text: string; joiner?: string; open?: boolean; close?: boolean }> = [];
        const wrap = active.groups.length > 1;
        active.groups.forEach((g, gi) => {
            g.conds.forEach((c, ci) => {
                out.push({
                    text: phrase(c, names),
                    joiner: ci > 0 ? t(g.match === 'any' ? 'or_word' : 'and_word') : gi > 0 ? t('or_group') : undefined,
                    open: wrap && ci === 0 && g.conds.length > 1,
                    close: wrap && ci === g.conds.length - 1 && g.conds.length > 1,
                });
            });
        });
        return out;
    }

    return { t, field, op, eventType, rule, sex, living, value, phrase, summary };
}
