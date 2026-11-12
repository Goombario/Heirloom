'use client';

import { useTranslations } from 'next-intl';
import { SegmentedControl, SectionHeader, cx } from '@/app/components/ui';
import type { CaseClaim, CaseClaimDecision, CaseFinding } from '@/lib/db/schema';
import { claimWhat, holdsDecisions, whichHolds, type ClaimConflict, type ClaimSide, type Holds } from './claims';

const joined = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(', ');

/**
 * Two findings disagree (#58): each pair of claims about the same thing and the
 * same person that say different things, side by side, with Which holds? (the
 * first source, the second, both can be true, or undecided). The answer is the
 * two claims' decisions, so it shows in the findings below and in All evidence.
 */
export function Disagreements({ conflicts, isLocked, busy, onDecide }: {
    conflicts: ClaimConflict[];
    /** Whether a finding's decisions are locked (a settled lead, no access, or already in the tree). */
    isLocked: (finding: CaseFinding, claim: CaseClaim) => boolean;
    busy: boolean;
    onDecide: (claim: CaseClaim, decision: CaseClaimDecision) => void;
}) {
    const t = useTranslations('caseResearch');
    const title = (s: ClaimSide) => s.finding.citation?.sourceTitle || t('untitled_record');
    const choose = (c: ClaimConflict, holds: Holds) => {
        const [x, y] = holdsDecisions(holds);
        if (c.a.claim.Decision !== x) onDecide(c.a.claim, x);
        if (c.b.claim.Decision !== y) onDecide(c.b.claim, y);
    };

    return (
        <section aria-labelledby="disagree-title" className="grid gap-2.5">
            <SectionHeader level="section" headingId="disagree-title" title={t('disagree_title')} count={conflicts.length} />
            {conflicts.map((c) => {
                const locked = isLocked(c.a.finding, c.a.claim) || isLocked(c.b.finding, c.b.claim);
                const about = joined(claimWhat(c.a.claim.What, t), c.a.claim.personLabel ?? c.a.claim.PersonName);
                return (
                    <div key={c.key} className={cx('rounded-card', 'grid gap-3 border border-border bg-card p-4')}>
                        <span className="text-sm font-medium text-text">{about}</span>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {[c.a, c.b].map((s) => (
                                <div key={s.claim.Id} className={cx('rounded-card', 'grid gap-0.5 bg-surface-2 px-3 py-2.5')}>
                                    <span className="text-meta text-text-muted break-words">{title(s)}</span>
                                    <span className="text-sm text-text break-words">{joined(s.claim.Date, s.claim.Place, s.claim.Says) || t('says_nothing')}</span>
                                </div>
                            ))}
                        </div>
                        <div className="grid gap-1.5">
                            <span aria-hidden="true" className="text-meta text-text-secondary">{t('which_holds')}</span>
                            <SegmentedControl
                                aria-label={t('which_holds_for', { what: about })}
                                value={whichHolds(c)}
                                disabled={locked || busy}
                                onChange={(v) => choose(c, v as Holds)}
                                options={[
                                    { v: 'a', l: title(c.a) },
                                    { v: 'b', l: title(c.b) },
                                    { v: 'both', l: t('holds_both') },
                                    { v: 'undecided', l: t('undecided') },
                                ]}
                                className="justify-self-start max-w-full"
                            />
                        </div>
                    </div>
                );
            })}
        </section>
    );
}
