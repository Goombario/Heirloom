'use client';

import { useTranslations } from 'next-intl';

/** Full-screen saving + export overlays for the tree page. */
export function TreeOverlays({ isSavingTree, isExporting }: { isSavingTree: boolean; isExporting: boolean }) {
    const t = useTranslations('treeView');
    return (
        <>
            {/* Saving overlay — shown during silent tree reload after sidebar save */}
            {isSavingTree && (
                <div
                    className="fixed inset-0 z-100 flex items-center justify-center pointer-events-none"
                    style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', backgroundColor: 'var(--color-scrim)' }}
                >
                    <div
                        className="flex flex-col items-center gap-4 px-8 py-6 rounded-2xl shadow-2xl"
                        style={{ background: 'color-mix(in srgb, var(--color-card) 15%, transparent)', border: '1px solid var(--color-glass-border)' }}
                    >
                        {/* Spinning ring with tree branches icon */}
                        <div className="relative w-16 h-16">
                            <div
                                className="absolute inset-0 rounded-full border-[3px] border-white/20 border-t-white/80"
                                style={{ animation: 'tree-save-spin 0.9s linear infinite' }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <svg className="w-8 h-8 text-white drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                        d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4M5 12h14" />
                                </svg>
                            </div>
                        </div>

                        <div className="text-center">
                            <p
                                className="text-white font-semibold text-base drop-shadow"
                                style={{ animation: 'tree-export-pulse 1.2s ease-in-out infinite' }}
                            >
                                {t('updating_tree')}
                            </p>
                            <p className="text-white/60 text-xs mt-1">{t('saving_changes')}</p>
                        </div>

                        {/* Shimmer bar */}
                        <div className="w-40 h-1 rounded-full overflow-hidden bg-white/20">
                            <div
                                className="h-full rounded-full bg-white/70"
                                style={{ animation: 'tree-export-shimmer 1.2s ease-in-out infinite' }}
                            />
                        </div>
                    </div>

                    <style>{`
                        @keyframes tree-save-spin {
                            from { transform: rotate(0deg); }
                            to { transform: rotate(360deg); }
                        }
                    `}</style>
                </div>
            )}

            {/* Export overlay */}
            {isExporting && (
                <div
                    className="fixed inset-0 z-100 flex items-center justify-center"
                    style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', backgroundColor: 'var(--color-scrim)' }}
                >
                    <div
                        className="flex flex-col items-center gap-5 px-10 py-8 rounded-2xl shadow-2xl"
                        style={{ background: 'color-mix(in srgb, var(--color-card) 15%, transparent)', border: '1px solid var(--color-glass-border)' }}
                    >
                        {/* Camera shutter ring */}
                        <div className="relative w-20 h-20">
                            <div
                                className="absolute inset-0 rounded-full border-4 border-white/30"
                                style={{ animation: 'tree-export-ping 1.4s cubic-bezier(0,0,0.2,1) infinite' }}
                            />
                            <div
                                className="absolute inset-2 rounded-full border-2 border-white/50"
                                style={{ animation: 'tree-export-ping 1.4s cubic-bezier(0,0,0.2,1) infinite 0.3s' }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <svg
                                    className="w-10 h-10 text-white drop-shadow-lg"
                                    style={{ animation: 'tree-export-pulse 1.4s ease-in-out infinite' }}
                                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </div>
                        </div>

                        {/* Label */}
                        <div className="text-center">
                            <p
                                className="text-white font-semibold text-lg drop-shadow"
                                style={{ animation: 'tree-export-pulse 1.4s ease-in-out infinite' }}
                            >
                                {t('exporting_image')}
                            </p>
                            <p className="text-white/60 text-sm mt-1">{t('preparing_tree')}</p>
                        </div>

                        {/* Shimmer bar */}
                        <div className="w-48 h-1 rounded-full overflow-hidden bg-white/20">
                            <div
                                className="h-full rounded-full bg-white/70"
                                style={{ animation: 'tree-export-shimmer 1.4s ease-in-out infinite' }}
                            />
                        </div>
                    </div>

                    <style>{`
                        @keyframes tree-export-ping {
                            0%, 100% { transform: scale(1); opacity: 0.6; }
                            50% { transform: scale(1.15); opacity: 0.15; }
                        }
                        @keyframes tree-export-pulse {
                            0%, 100% { opacity: 1; }
                            50% { opacity: 0.55; }
                        }
                        @keyframes tree-export-shimmer {
                            0% { transform: translateX(-100%); width: 60%; }
                            50% { transform: translateX(80%); width: 60%; }
                            100% { transform: translateX(200%); width: 60%; }
                        }
                    `}</style>
                </div>
            )}
        </>
    );
}
