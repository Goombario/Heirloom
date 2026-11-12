'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Button, cx } from '@/app/components/ui';
import type { CaseClaim, CaseFinding, CaseWithRelations } from '@/lib/db/schema';
import { claimWhat } from './claims';
import type { LeadSummary } from './useCaseWorkspace';

const joined = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(', ');

/**
 * A closed case's answer (#58, ADR 0046): what it concluded, what it added to
 * the tree (each with a link to the person and Undo), the leads it left open
 * (each a new case to start), and Reopen the case.
 */
export function ClosedAnswer({ caseData, findings, summaries, canUndo, canReopen, busy, onUndo, onReopen }: {
    caseData: CaseWithRelations;
    findings: CaseFinding[];
    summaries: LeadSummary[];
    /** Undo is a revert, so it takes Edit access. */
    canUndo: boolean;
    canReopen: boolean;
    busy: boolean;
    onUndo: (claim: CaseClaim) => void;
    onReopen: () => void;
}) {
    const t = useTranslations('caseResearch');
    const id = useId();
    const conclusion = [...caseData.comments].reverse().find((c) => c.Kind === 'conclusion')?.Body ?? '';
    const added = findings.flatMap((f) => f.claims.filter((c) => c.AppliedAt != null).map((claim) => ({ claim, finding: f })));
    const leftOpen = summaries.filter((s) => s.status !== 'settled');

    return (
        <article aria-labelledby={`${id}-title`} className="grid gap-6">
            <header className="grid gap-1">
                <p className="eyebrow m-0">{caseData.Outcome ? t(`outcome_${caseData.Outcome}`) : t('case_section')}</p>
                <h2 id={`${id}-title`} className="title m-0 serif text-text">{t('the_answer')}</h2>
            </header>
            {conclusion && <p className="m-0 text-base text-text whitespace-pre-wrap break-words">{conclusion}</p>}

            <section aria-labelledby={`${id}-added`} className="grid gap-2">
                <h3 id={`${id}-added`} className="section m-0">{t('added_to_tree')}</h3>
                {added.length === 0 ? (
                    <p className="m-0 text-sm text-text-muted">{t('added_none')}</p>
                ) : (
                    <ul className={cx('rounded-card', 'm-0 p-0 list-none border border-border divide-y divide-border')}>
                        {added.map(({ claim, finding }) => (
                            <li key={claim.Id} className="flex items-start gap-3 px-4 py-3">
                                <span className="grid gap-0.5 min-w-0 flex-1">
                                    <span className="text-sm font-medium text-text">
                                        {claimWhat(claim.What, t)}{claim.personLabel && <> · <span className="serif">{claim.personLabel}</span></>}
                                    </span>
                                    {joined(claim.Date, claim.Place, claim.Says) && <span className="text-sm text-text-secondary break-words">{joined(claim.Date, claim.Place, claim.Says)}</span>}
                                    {finding.citation && <span className="text-meta text-text-muted break-words">{t('change_from', { source: finding.citation.sourceTitle })}</span>}
                                    {claim.PersonId != null && (
                                        <Link href={`/people/view?id=${claim.PersonId}`} className="justify-self-start text-meta text-link hover:underline focus-ring rounded-sm">
                                            {t('on_their_page', { name: claim.personLabel ?? '' })}
                                        </Link>
                                    )}
                                </span>
                                {canUndo && claim.undoable && (
                                    <Button variant="outline" size="sm" disabled={busy} onClick={() => onUndo(claim)}
                                        aria-label={t('undo_change', { what: claimWhat(claim.What, t), name: claim.personLabel ?? '' })}>
                                        {t('undo')}
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {leftOpen.length > 0 && (
                <section aria-labelledby={`${id}-open`} className="grid gap-2">
                    <h3 id={`${id}-open`} className="section m-0">{t('left_open')}</h3>
                    <ul className="m-0 p-0 list-none grid gap-2">
                        {leftOpen.map((s) => (
                            <li key={s.lead.Id} className="flex items-center justify-between gap-3 text-sm">
                                <span className="min-w-0 break-words text-text">{s.lead.Question}</span>
                                {canReopen && (
                                    <Link href={`/cases/new?q=${encodeURIComponent(s.lead.Question)}`} className="shrink-0 text-sm text-link hover:underline focus-ring rounded-sm">
                                        {t('start_case_from')}
                                    </Link>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {canReopen && (
                <div className="flex justify-end border-t border-border pt-5">
                    <Button variant="outline" onClick={onReopen} disabled={busy}>{t('reopen_case')}</Button>
                </div>
            )}
        </article>
    );
}
