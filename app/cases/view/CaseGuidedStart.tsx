'use client';

import { Compass, Check, ChevronRight } from '@/lib/icons';
import type { CaseDetailState } from './useCaseDetail';
import { writtenEntries } from './case-detail-helpers';

/**
 * Guided-start card shown in the journal area of a brand-new case (no entries
 * yet). Four steps reflect real progress and are wired to focus/open the
 * matching affordance. Reuses the existing rail pickers rather than net-new
 * modals (those stay a reviewed follow-up).
 */
export default function CaseGuidedStart({ cd }: { cd: CaseDetailState }) {
    const { caseData, caseReady, setShowComposerCite, setMobileTab, t } = cd;
    if (!caseData) return null;

    const g0 = (caseData.Title ?? '').trim().length > 0;
    const g1 = caseData.people.length > 0;
    const g2 = caseData.citations.length > 0;
    const g3 = writtenEntries(caseData.comments).length > 0;
    const done = (g0 ? 1 : 0) + (g1 ? 1 : 0) + (g2 ? 1 : 0) + (g3 ? 1 : 0);
    const nextIdx = [g0, g1, g2, g3].findIndex(d => !d);

    const focusEl = (selector: string) => {
        // Cross-component focus-by-id: the guided-start steps focus inputs that
        // live in sibling components (header/rail/composer), so a shared ref
        // isn't available — a scoped query is the pragmatic mechanism.
        // eslint-disable-next-line no-restricted-syntax
        const el = document.querySelector<HTMLElement>(selector);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => el?.focus(), 250);
    };

    // People/composer live in the Evidence tab / Journal tab on mobile — switch
    // to the right tab first so the focus target is actually rendered.
    const addPeople = () => { setMobileTab('evidence'); setTimeout(() => focusEl('#case-people-input input'), 60); };

    const steps = [
        { done: g0, label: t('step_name_case'), sub: t('step_name_case_sub'), onClick: () => focusEl('#case-title-input') },
        { done: g1, label: t('step_add_people'), sub: t('step_add_people_sub'), onClick: addPeople },
        { done: g2, label: t('step_cite_source'), sub: t('step_cite_source_sub'), onClick: () => setShowComposerCite(true) },
        { done: g3, label: t('step_log_known'), sub: t('step_log_known_sub'), onClick: () => focusEl('#case-composer') },
    ];

    return (
        <div className="border border-dashed border-border rounded-2xl p-5 mb-5">
            <div className="text-center max-w-[320px] mx-auto mb-4">
                <div className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-3">
                    <Compass className="w-[22px] h-[22px] text-text-secondary" aria-hidden="true" />
                </div>
                <h3 className="serif text-lg font-semibold mb-1 text-text">{t('start_research')}</h3>
                <p className="text-sm text-text-muted leading-snug">{t('start_research_sub')}</p>
                <p className="tabular-nums text-xs text-text-muted mt-2">{t('steps_progress', { done, total: 4 })}</p>
                {!caseReady && (
                    <p className="text-xs text-warning-text mt-1.5">{t('steps_locked_hint')}</p>
                )}
            </div>
            <div className="flex flex-col gap-2 max-w-[440px] mx-auto">
                {steps.map((s, i) => {
                    const isNext = i === nextIdx;
                    // Step 1 (Name your case) is the action that MAKES the case ready,
                    // so it stays enabled while !caseReady; steps 2-4 lock until then.
                    const locked = !s.onClick || (!caseReady && i !== 0);
                    const cursor = !locked ? 'cursor-pointer' : !caseReady ? 'cursor-not-allowed' : 'cursor-default';
                    // Draft steps read as inert (dimmed like the composer); enabled steps
                    // keep their done/next hover treatment.
                    const surface = s.done
                        ? 'bg-success-bg border-success'
                        : locked
                            ? 'bg-card border-border'
                            : 'bg-card border-border hover:border-primary hover:bg-surface-2';
                    return (
                        <button
                            key={s.label}
                            type="button"
                            onClick={s.onClick}
                            disabled={locked}
                            className={`flex items-center gap-3 border rounded-xl px-3.5 py-2.5 text-left w-full transition-colors focus-ring ${cursor} ${locked ? 'opacity-60' : ''} ${surface}`}
                        >
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold tabular-nums ${s.done ? 'bg-success text-white' : isNext ? 'bg-primary text-white' : 'bg-card-alt border border-border text-text-muted'}`}>
                                {s.done ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : i + 1}
                            </span>
                            <span className="flex-1 min-w-0">
                                <span className="block text-[13.5px] font-semibold text-text">{s.label}</span>
                                <span className="block text-meta text-text-muted">{s.sub}</span>
                            </span>
                            {s.done
                                ? <Check className="w-4 h-4 text-success" aria-hidden="true" />
                                : <ChevronRight className="w-4 h-4 text-text-muted" aria-hidden="true" />}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
