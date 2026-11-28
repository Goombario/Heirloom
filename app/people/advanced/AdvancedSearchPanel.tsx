'use client';

import { Fragment } from 'react';
import { Bookmark, Plus, X } from '@/lib/icons';
import { Button, Card, IconButton, Input, SegmentedControl, SelectField, cx } from '@/app/components/ui';
import PersonPicker from '@/app/components/PersonPicker';
import type { PersonResult } from '@/lib/db/schema';
import { DATA_CHECK_RULES } from '@/lib/data-checks/rules';
import {
    FIELD_GROUPS, FIELD_IDS, FIELDS, LIVING_VALUES, MAX_STEPS, SEX_VALUES, newCondition, valueKind,
    type FieldId, type OpId, type RelationKind, type SearchCondition, type SearchGroup, type SearchQuery,
} from '@/lib/search/people-query';
import { useSearchWords } from './useSearchWords';
import type { SearchLookups } from './useSearchLookups';

const REL_KINDS: readonly RelationKind[] = ['related', 'ancestor', 'descendant', 'close'];

/** A condition with a new condition (op): the value stays when it means the same thing. */
function withOp(c: SearchCondition, op: OpId): SearchCondition {
    const same = valueKind(c.field, c.op) === valueKind(c.field, op);
    const next: SearchCondition = { ...c, op };
    if (!same) { delete next.v; delete next.v2; delete next.id; }
    if (op !== 'between') delete next.v2;
    return next;
}

interface RowProps {
    cond: SearchCondition;
    onChange: (c: SearchCondition) => void;
    onRemove: () => void;
    lookups: SearchLookups;
    personFor: (id: number) => PersonResult | null;
    treeId: number | null;
}

function ValueEditor({ cond, onChange, lookups, personFor, treeId }: Omit<RowProps, 'onRemove'>) {
    const w = useSearchWords();
    const { t } = w;
    const kind = valueKind(cond.field, cond.op);
    const set = (patch: Partial<SearchCondition>) => onChange({ ...cond, ...patch });
    const label = `${w.field(cond.field)} ${w.op(cond.op)}`;
    switch (kind) {
        case 'none': return <span />;
        case 'text':
        case 'date':
        case 'number':
        case 'place': {
            const ph = t(kind === 'date' ? 'value_date' : kind === 'number' ? 'value_number' : kind === 'place' ? 'value_place' : 'value_text');
            const input = (v: string | undefined, key: 'v' | 'v2', aria: string) => (
                <Input
                    size="sm"
                    type={kind === 'number' ? 'number' : 'text'}
                    inputMode={kind === 'number' ? 'numeric' : undefined}
                    value={v ?? ''}
                    onChange={(e) => set({ [key]: e.target.value })}
                    placeholder={ph}
                    aria-label={aria}
                    wrapClassName={cond.op === 'between' ? 'w-28' : 'flex-1 min-w-0'}
                />
            );
            if (cond.op === 'between') {
                return (
                    <span className="flex items-center gap-2 min-w-0">
                        {input(cond.v, 'v', label)}
                        <span className="text-meta text-text-muted">{t('and_word')}</span>
                        {input(cond.v2, 'v2', t('value_second', { label }))}
                    </span>
                );
            }
            return (
                <span className="flex items-center gap-2 min-w-0">
                    {input(cond.v, 'v', label)}
                    {cond.op === 'is_in' && <span className="text-meta text-text-muted whitespace-nowrap">{t('place_inside')}</span>}
                </span>
            );
        }
        case 'sex':
        case 'living': {
            const values = kind === 'sex' ? SEX_VALUES : LIVING_VALUES;
            return (
                <SelectField
                    size="sm"
                    width="w-44"
                    aria-label={label}
                    value={cond.v ?? ''}
                    placeholder={t('choose')}
                    options={values.map((v) => ({ value: v, label: kind === 'sex' ? w.sex(v) : w.living(v) }))}
                    onChange={(v) => set({ v })}
                />
            );
        }
        case 'event_type':
            return (
                <SelectField
                    size="sm"
                    width="w-56"
                    aria-label={label}
                    value={cond.v ?? ''}
                    placeholder={t('pick_event')}
                    options={lookups.eventTypes.map((v) => ({ value: v, label: w.eventType(v) }))}
                    onChange={(v) => set({ v })}
                />
            );
        case 'rule':
            return (
                <SelectField
                    size="sm"
                    aria-label={label}
                    value={cond.v ?? ''}
                    placeholder={t('pick_rule')}
                    options={DATA_CHECK_RULES.map((r) => ({ value: r.id, label: w.rule(r.id) }))}
                    onChange={(v) => set({ v })}
                />
            );
        case 'source':
        case 'case': {
            const list = kind === 'source' ? lookups.sources : lookups.cases;
            return (
                <SelectField
                    size="sm"
                    aria-label={label}
                    value={cond.id ? String(cond.id) : ''}
                    placeholder={t(kind === 'source' ? 'pick_source' : 'pick_case')}
                    options={list.map((r) => ({ value: String(r.id), label: r.title || t('untitled') }))}
                    onChange={(v) => set({ id: Number(v) })}
                />
            );
        }
        case 'person':
            return (
                <div className="min-w-0">
                    <PersonPicker
                        value={cond.id ? personFor(cond.id) : null}
                        onChange={(p) => set({ id: p?.Id })}
                        treeId={treeId}
                        showDates
                        placeholder={t('pick_person')}
                    />
                </div>
            );
    }
}

function ConditionRow(props: RowProps) {
    const { cond, onChange, onRemove } = props;
    const w = useSearchWords();
    const { t } = w;
    const fieldGroups = FIELD_GROUPS.map((g) => ({
        key: g,
        label: t(`group_${g}`),
        options: FIELD_IDS.filter((f) => FIELDS[f].group === g).map((f) => ({ value: f, label: w.field(f) })),
    }));
    const rel = cond.field === 'relationship';
    return (
        <div className="mb-1.5">
            <div className="grid gap-2 items-center grid-cols-[170px_190px_minmax(0,1fr)_28px]">
                <SelectField<FieldId>
                    size="sm"
                    aria-label={t('field_label')}
                    value={cond.field}
                    groups={fieldGroups}
                    onChange={(f) => { if (f !== cond.field) onChange(newCondition(f)); }}
                />
                {rel ? (
                    <SelectField<RelationKind>
                        size="sm"
                        aria-label={t('rel_label')}
                        value={cond.rel ?? 'related'}
                        options={REL_KINDS.map((k) => ({ value: k, label: t(`rel_${k}`) }))}
                        onChange={(k) => onChange({ ...cond, rel: k })}
                    />
                ) : (
                    <SelectField<OpId>
                        size="sm"
                        aria-label={t('op_label')}
                        value={cond.op}
                        options={FIELDS[cond.field].ops.map((o) => ({ value: o, label: w.op(o) }))}
                        onChange={(o) => onChange(withOp(cond, o))}
                    />
                )}
                <ValueEditor {...props} />
                <IconButton label={t('remove_condition')} size="sm" icon={<X className="w-4 h-4" aria-hidden="true" />} onClick={onRemove} />
            </div>
            {rel && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1.5 ml-[178px] text-meta text-text-muted">
                    <span>{t('count_by')}</span>
                    <SegmentedControl
                        aria-label={t('count_by')}
                        value={cond.marriage === false ? 'blood' : 'both'}
                        options={[{ v: 'both', l: t('blood_marriage') }, { v: 'blood', l: t('blood_only') }]}
                        onChange={(v) => onChange({ ...cond, marriage: v !== 'blood' })}
                    />
                    <span className="inline-flex items-center gap-1.5">
                        {t('within')}
                        <Input
                            size="sm"
                            type="number"
                            min={1}
                            max={MAX_STEPS}
                            value={String(cond.steps ?? 6)}
                            onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1) onChange({ ...cond, steps: Math.min(n, MAX_STEPS) }); }}
                            aria-label={t('steps_label')}
                            wrapClassName="w-16"
                        />
                        {t('steps')}
                    </span>
                    <span className="basis-full">{t('steps_hint')}</span>
                </div>
            )}
            {valueKind(cond.field, cond.op) === 'date' && cond.op === 'between' && (
                <p className="mt-1 ml-[178px] text-meta text-text-muted">{t('date_hint')}</p>
            )}
        </div>
    );
}

/**
 * The advanced search panel above the People list (#247, layout A): groups of
 * field + condition + value rows, "all" or "any" inside a group, OR between
 * groups, with the live count and Save underneath.
 */
export function AdvancedSearchPanel({ query, onChange, count, onHide, onClear, onSave, lookups, personFor, treeId }: {
    query: SearchQuery;
    onChange: (q: SearchQuery) => void;
    /** How many people match now; null while it is counted. */
    count: number | null;
    onHide: () => void;
    onClear: () => void;
    onSave?: () => void;
    lookups: SearchLookups;
    personFor: (id: number) => PersonResult | null;
    treeId: number | null;
}) {
    const { t } = useSearchWords();
    const groups: SearchGroup[] = query.groups.length > 0 ? query.groups : [{ match: 'all', conds: [newCondition('death_date')] }];
    const setGroup = (gi: number, g: SearchGroup | null) => {
        const next = groups.map((x, i) => (i === gi ? g : x)).filter((x): x is SearchGroup => !!x && x.conds.length > 0);
        onChange({ groups: next });
    };
    return (
        <Card pad={false} role="region" aria-label={t('panel_title')} className="mb-3 px-4 pt-3.5 pb-3">
            <div className="flex items-center gap-2.5 mb-2.5">
                <h2 className="serif text-md font-semibold">{t('panel_title')}</h2>
                <span className="text-meta text-text-muted">{t(groups.length > 1 ? 'panel_sub_groups' : 'panel_sub_one')}</span>
                <span className="flex-1" />
                <button type="button" onClick={onHide} className="text-meta text-link hover:underline focus-ring rounded">{t('hide')}</button>
            </div>
            {groups.map((g, gi) => (
                <Fragment key={gi}>
                    {gi > 0 && (
                        <div className="flex items-center gap-2.5 my-2" aria-hidden="true">
                            <span className="text-xs font-semibold tracking-[.08em] uppercase bg-segment-on text-on-segment rounded-full px-2.5 py-1">{t('or_group')}</span>
                        </div>
                    )}
                    <div role="group" aria-label={t('group_label', { n: gi + 1 })} className="bg-card-alt border border-border rounded-[10px] px-3 pt-2.5 pb-2">
                        <div className="flex items-center gap-2 text-meta text-text-muted mb-2">
                            {t('match_before')}
                            <SegmentedControl
                                aria-label={t('match_label')}
                                value={g.match}
                                options={[{ v: 'all', l: t('match_all') }, { v: 'any', l: t('match_any') }]}
                                onChange={(v) => setGroup(gi, { ...g, match: v === 'any' ? 'any' : 'all' })}
                            />
                            {t('match_after')}
                        </div>
                        {g.conds.map((c, ci) => (
                            <ConditionRow
                                key={ci}
                                cond={c}
                                onChange={(nc) => setGroup(gi, { ...g, conds: g.conds.map((x, i) => (i === ci ? nc : x)) })}
                                onRemove={() => setGroup(gi, { ...g, conds: g.conds.filter((_, i) => i !== ci) })}
                                lookups={lookups}
                                personFor={personFor}
                                treeId={treeId}
                            />
                        ))}
                        <button type="button" onClick={() => setGroup(gi, { ...g, conds: [...g.conds, newCondition('given')] })} className="inline-flex items-center gap-1.5 text-meta text-link hover:underline py-1 px-0.5 focus-ring rounded">
                            <Plus className="w-3.5 h-3.5" aria-hidden="true" />{t('add_condition')}
                        </button>
                    </div>
                </Fragment>
            ))}
            <div className="mt-2">
                <button type="button" onClick={() => onChange({ groups: [...groups, { match: 'all', conds: [newCondition('given')] }] })} className="inline-flex items-center gap-1.5 text-meta text-link hover:underline py-1 px-0.5 focus-ring rounded">
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />{t('add_group')}
                </button>
            </div>
            <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-border">
                <span className="text-sm" aria-live="polite">
                    <span className={cx('inline-block w-[7px] h-[7px] rounded-full mr-1.5 align-[1px]', count === null ? 'bg-border' : 'bg-success')} aria-hidden="true" />
                    {count === null ? t('counting') : t.rich('match_count', { count, b: (chunks) => <b className="font-semibold">{chunks}</b> })}
                </span>
                <span className="flex-1" />
                <Button variant="ghost" size="sm" onClick={onClear}>{t('clear_all')}</Button>
                {onSave && <Button variant="outline" size="sm" icon={<Bookmark className="w-3.5 h-3.5" aria-hidden="true" />} onClick={onSave}>{t('save_search')}</Button>}
            </div>
        </Card>
    );
}
