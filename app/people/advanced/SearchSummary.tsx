'use client';

import { Fragment } from 'react';
import { Button, Card, EmptyState } from '@/app/components/ui';
import { activeQuery, type SearchQuery } from '@/lib/search/people-query';
import { useSearchWords, type RecordNames } from './useSearchWords';

const LINK = 'text-meta text-link hover:underline focus-ring rounded bg-transparent border-0 p-0 cursor-pointer';

/** The query in words, each condition bold, groups in brackets joined by an OR pill. */
function Sentence({ query, names }: { query: SearchQuery; names: RecordNames }) {
    const w = useSearchWords();
    return (
        <span>
            {w.summary(query, names).map((part, i) => (
                <Fragment key={i}>
                    {part.joiner && (i > 0 && part.joiner === w.t('or_group')
                        ? <span className="mx-1 text-xs font-semibold tracking-[.08em] uppercase bg-segment-on text-on-segment rounded-full px-1.5 py-0.5">{part.joiner}</span>
                        : <> {part.joiner} </>)}
                    {part.open && '('}
                    <b className="font-semibold">{part.text}</b>
                    {part.close && ')'}
                </Fragment>
            ))}
        </span>
    );
}

/**
 * The closed panel (#247, layout A): "Showing (…) OR (…)" with Edit, Save and
 * Clear. On the phone, where the builder isn't offered yet, it is how a shared
 * link's search shows and clears.
 */
export function SearchSummary({ query, names, onEdit, onSave, onClear, className = '' }: {
    query: SearchQuery;
    names: RecordNames;
    onEdit?: () => void;
    onSave?: () => void;
    onClear: () => void;
    className?: string;
}) {
    const { t } = useSearchWords();
    return (
        <div className={`flex flex-wrap items-center gap-2 bg-card border border-border rounded-[10px] px-3 py-2 text-sm ${className}`}>
            <span className="eyebrow font-semibold text-text-muted">{t('showing')}</span>
            <Sentence query={query} names={names} />
            <span className="flex-1" />
            {onEdit && <button type="button" className={LINK} onClick={onEdit}>{t('edit')}</button>}
            {onSave && <button type="button" className={LINK} onClick={onSave}>{t('save_short')}</button>}
            <button type="button" className={LINK} onClick={onClear}>{t('clear')}</button>
        </div>
    );
}

/**
 * No one matches (#247): how many each condition's removal would bring back, with
 * Remove on the ones that bring anyone.
 */
export function NoMatches({ query, without, names, onRemove, onClear }: {
    query: SearchQuery;
    /** Counts without each condition, in `activeQuery` order. */
    without: number[] | undefined;
    names: RecordNames;
    onRemove: (group: number, cond: number) => void;
    onClear: () => void;
}) {
    const w = useSearchWords();
    const { t } = w;
    const rows = activeQuery(query).groups.flatMap((g, gi) => g.conds.map((c, ci) => ({ c, gi, ci })));
    if (!without || without.length !== rows.length) {
        return <EmptyState variant="filtered" title={t('none_title')} message={t('none_body_plain')} clearLabel={t('clear_all')} onClear={onClear} />;
    }
    // The query's own rows, so Remove takes out the one the user sees (incomplete ones aren't counted).
    const position = (c: (typeof rows)[number]['c']) => {
        for (let gi = 0; gi < query.groups.length; gi++) {
            const ci = query.groups[gi].conds.indexOf(c);
            if (ci >= 0) return { gi, ci };
        }
        return null;
    };
    const ordered = rows.map((r, i) => ({ ...r, n: without[i] })).sort((a, b) => b.n - a.n);
    return (
        <Card pad={false} className="px-5 pt-7 pb-6 text-center">
            <div className="serif text-lg font-semibold">{t('none_title')}</div>
            <p className="text-text-muted text-sm mt-1.5">{t('none_body')}</p>
            <ul className="text-left max-w-[460px] mx-auto mt-3.5 border border-border rounded-[10px]">
                {ordered.map((r, i) => {
                    const at = position(r.c);
                    return (
                        <li key={i} className="flex items-center gap-2.5 px-3 py-2 text-sm border-t border-border first:border-t-0">
                            <span>{t.rich('without', { cond: w.phrase(r.c, names), b: (chunks) => <b className="font-semibold">{chunks}</b> })}</span>
                            <span className="flex-1" />
                            <span className="text-text-muted whitespace-nowrap">{t('people_count', { count: r.n })}</span>
                            {r.n > 0 && at
                                ? <button type="button" className={LINK} onClick={() => onRemove(at.gi, at.ci)}>{t('remove')}</button>
                                : <span className="invisible text-meta" aria-hidden="true">{t('remove')}</span>}
                        </li>
                    );
                })}
            </ul>
            <div className="mt-3.5"><Button variant="outline" size="sm" onClick={onClear}>{t('clear_all')}</Button></div>
        </Card>
    );
}
