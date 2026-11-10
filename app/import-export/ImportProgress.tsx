'use client';

interface ImportProgressProps {
    /** Localized phase label. */
    label: string;
    /**
     * Omit both for the hosted parse + database-write step: one server call with
     * no live count → indeterminate bar. The browser build's import phases (ST-1)
     * and the per-file media upload pass current/total → determinate bar.
     */
    current?: number;
    total?: number;
}

/**
 * Progress indicator for the import flow. Honest about what's observable: a
 * hosted import is a single request so it shows an indeterminate animated bar;
 * the browser build's import phases and the media-upload phase report real X / Y.
 * Degrades to a static bar under prefers-reduced-motion.
 */
export default function ImportProgress({ label, current, total }: ImportProgressProps) {
    const determinate = total != null && total > 0;
    const pct = determinate ? Math.min(100, Math.round(((current ?? 0) / total!) * 100)) : 0;

    return (
        <div role="status" aria-live="polite" className="mb-1">
            <div className="flex justify-between items-center mb-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <span>{label}</span>
                {determinate && (
                    <span className="text-meta" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {current} / {total}
                    </span>
                )}
            </div>
            <div className="h-1.5 rounded-[999px] overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                {determinate ? (
                    <div className="rounded-[999px]" style={{ height: '100%', width: `${pct}%`, background: 'var(--primary)', transition: 'width 0.2s ease' }} />
                ) : (
                    <div className="import-progress-bar rounded-[999px]" style={{ height: '100%', background: 'var(--primary)' }} />
                )}
            </div>
            <style>{`
                .import-progress-bar { width: 40%; animation: import-progress-slide 1.1s ease-in-out infinite; }
                @keyframes import-progress-slide {
                    0% { transform: translateX(-110%); }
                    100% { transform: translateX(360%); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .import-progress-bar { animation: none; width: 100%; opacity: 0.55; }
                }
            `}</style>
        </div>
    );
}
