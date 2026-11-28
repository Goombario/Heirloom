'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, IconButton } from '@/app/components/ui';
import { ChevronRight, X } from '@/lib/icons';
import type { RelationshipResult } from '@/lib/data/types';
import { sharedAncestor, wholePathRoot, type RelatePair } from '@/lib/tree/relate';

/**
 * The result of "How are they related?" on the tree (#256): a card at the foot of
 * the canvas with the relationship in the Relationship tool's words, the steps, the
 * people on the path (each opens their page) and the shared ancestor. When the path
 * runs through someone this view doesn't draw, it says who and offers a view that
 * draws the whole path; the tree never switches view by itself.
 */
export function TreeRelateCard({ pair, result, drawn, nameOf, onClear, onShowWhole }: {
    pair: RelatePair;
    result: RelationshipResult | null;
    drawn: Set<number>;
    nameOf: (id: number) => string;
    onClear: () => void;
    /** Re-roots the tree on Descendants of this person, keeping the comparison. */
    onShowWhole: (rootId: number) => void;
}) {
    const t = useTranslations('treeView');
    const tRel = useTranslations('relationship');
    if (pair.first == null || pair.second == null) return null;
    const path = result?.path ?? [];
    const missing = path.filter((s) => !drawn.has(s.id));
    const peak = sharedAncestor(path);
    const root = wholePathRoot(path);
    const names = { a: nameOf(pair.first), b: nameOf(pair.second) };

    return (
        <section className="tree-relate-card" aria-label={t('relate_title')}>
            <div className="tree-relate-card__top">
                <div className="min-w-0">
                    <p className="eyebrow m-0">{t('relate_title')}</p>
                    <h2 role="status" className="m-0 serif text-2xl font-semibold leading-tight text-text">
                        {result ? result.relationship || t('relate_failed') : tRel('calculating')}
                    </h2>
                    <p className="m-0 text-sm text-text-secondary">
                        {t('relate_pair', names)}
                        {result && result.degree > 0 && <span className="font-mono text-meta text-text-muted ml-1.5">{tRel('steps_apart', { count: result.degree })}</span>}
                    </p>
                </div>
                <IconButton size="sm" label={t('relate_clear')} icon={<X className="w-4 h-4" aria-hidden="true" />} onClick={onClear} />
            </div>
            {path.length > 0 && (
                <ol aria-label={tRel('path_heading')} className="tree-relate-chain">
                    {path.map((step, i) => (
                        <li key={step.id}>
                            <Link href={`/people/view?id=${step.id}`} className="tree-relate-chip focus-ring">{step.name}</Link>
                            {i < path.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-text-muted" aria-hidden="true" />}
                        </li>
                    ))}
                </ol>
            )}
            {missing.length > 0 && root != null ? (
                <div className="tree-relate-card__foot">
                    <span>{t('relate_not_drawn', { names: missing.map((s) => s.name).join(', ') })}</span>
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => onShowWhole(root)}>{t('relate_show_whole')}</Button>
                </div>
            ) : peak != null ? (
                <div className="tree-relate-card__foot">
                    <span>{tRel('shared_ancestor', { name: path.find((s) => s.id === peak)?.name ?? '' })}</span>
                </div>
            ) : null}
        </section>
    );
}

/** While the panel's button waits for a second person, and while Shift is held. */
export function TreeRelateHint({ picking, shiftHeld, firstName, onCancel }: {
    picking: boolean;
    shiftHeld: boolean;
    firstName: string | null;
    onCancel: () => void;
}) {
    const t = useTranslations('treeView');
    if (picking && firstName) {
        return (
            <div className="tree-relate-hint" role="status">
                <span>{t('relate_pick', { name: firstName })}</span>
                <Button variant="outline" size="sm" onClick={onCancel}>{t('relate_cancel')}</Button>
            </div>
        );
    }
    if (shiftHeld) {
        return <div className="tree-relate-hint tree-relate-hint--quiet" role="status">{t('relate_shift_hint')}</div>;
    }
    return null;
}
