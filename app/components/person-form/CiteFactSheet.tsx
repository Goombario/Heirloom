'use client';

import { useTranslations } from 'next-intl';
import { BookOpen, ImageUp, ChevronRight } from '@/lib/icons';
import { Sheet } from '@/app/components/ui/Sheet';
import type { AttachTarget } from '@/app/components/person-form/usePersonForm';

interface CiteFactSheetProps {
    /** Non-null when the sheet should be open. */
    target: AttachTarget | null;
    onClose: () => void;
    /** Called when the user taps a row; parent should set attachTarget to drive AttachSourceSidebar. */
    onProceed: (target: AttachTarget) => void;
}

/**
 * CiteFactSheet — mobile-only launcher sheet (no text inputs).
 * Appears between a cite-pin tap and AttachSourceSidebar on narrow viewports.
 * Uses ui/Sheet (Vaul) for swipe-to-dismiss, scrim-tap, and Esc handling.
 * On desktop this component never mounts (Sheet gates on useIsMobile internally).
 */
export function CiteFactSheet({ target, onClose, onProceed }: CiteFactSheetProps) {
    const t = useTranslations('editPerson');

    return (
        <Sheet
            open={target !== null}
            onClose={onClose}
            title={t('cite_fact_title')}
        >
            {target !== null && (
                <div className="px-1 pb-2">
                    {/* Subtitle: which fact is being cited */}
                    <p className="text-sm text-text-muted mb-4 px-1">
                        {t('cite_fact_body', { fact: target.factLabel.toLocaleLowerCase() })}
                    </p>

                    {/* Row: From the library */}
                    <button
                        type="button"
                        onClick={() => onProceed(target)}
                        aria-label={t('cite_from_library')}
                        title={t('cite_from_library')}
                        className="w-full flex items-center gap-3 px-2 rounded-lg hover:bg-[color:var(--color-hover-surface)] text-left cursor-pointer min-h-[52px] focus-ring"
                    >
                        <BookOpen className="w-5 h-5 text-text-muted flex-shrink-0" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-text leading-tight">
                                {t('cite_from_library')}
                            </div>
                            <div className="text-xs text-text-muted mt-0.5">
                                {t('cite_from_library_sub')}
                            </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" aria-hidden="true" />
                    </button>

                    {/* Row: Upload a photo or document */}
                    <button
                        type="button"
                        onClick={() => onProceed(target)}
                        aria-label={t('cite_upload')}
                        title={t('cite_upload')}
                        className="w-full flex items-center gap-3 px-2 rounded-lg hover:bg-[color:var(--color-hover-surface)] text-left cursor-pointer min-h-[52px] focus-ring"
                    >
                        <ImageUp className="w-5 h-5 text-text-muted flex-shrink-0" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-text leading-tight">
                                {t('cite_upload')}
                            </div>
                            <div className="text-xs text-text-muted mt-0.5">
                                {t('cite_upload_sub')}
                            </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" aria-hidden="true" />
                    </button>
                </div>
            )}
        </Sheet>
    );
}
