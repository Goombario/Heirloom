'use client';

import { useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { IconButton, cx } from '@/app/components/ui';
import { X } from '@/lib/icons';

export type SideTab = 'record' | 'journal';

/**
 * The right column (#58): tabs Record (Find a record while that is open) and
 * Journal. With nothing open there is only the journal, and no tabs.
 */
export function ResearchSide({ recordLabel, record, journal, tab, onTab, onCloseRecord }: {
    /** "Record" or "Find a record"; null when neither is open. */
    recordLabel: string | null;
    record: React.ReactNode;
    journal: React.ReactNode;
    tab: SideTab;
    onTab: (tab: SideTab) => void;
    onCloseRecord: () => void;
}) {
    const t = useTranslations('caseResearch');
    const id = useId();
    const refs = useRef<Record<SideTab, HTMLButtonElement | null>>({ record: null, journal: null });
    if (recordLabel == null) return <>{journal}</>;

    const tabs: Array<[SideTab, string]> = [['record', recordLabel], ['journal', t('journal')]];
    const current: SideTab = tab;
    const onKey = (e: React.KeyboardEvent) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next: SideTab = current === 'record' ? 'journal' : 'record';
        onTab(next);
        refs.current[next]?.focus();
    };

    return (
        <div className="grid gap-3">
            {/* Underlined tabs across the pane's top, as on the board (KsNav). */}
            <div className="flex items-center gap-2 -mx-7 px-7 -mt-4 border-b border-border">
                <div role="tablist" aria-label={t('side_label')} className="flex flex-1 gap-5" onKeyDown={onKey}>
                    {tabs.map(([key, label]) => (
                        <button key={key} ref={(el) => { refs.current[key] = el; }} type="button" role="tab" id={`${id}-${key}`}
                            aria-selected={current === key} aria-controls={`${id}-${key}-panel`} tabIndex={current === key ? 0 : -1}
                            onClick={() => onTab(key)}
                            className={cx('h-11 -mb-px border-0 border-b-2 border-solid bg-transparent px-0 text-sm cursor-pointer focus-ring',
                                current === key ? 'border-text text-text font-semibold' : 'border-transparent text-text-secondary hover:text-text')}>
                            {label}
                        </button>
                    ))}
                </div>
                <IconButton label={t('close_record', { label: recordLabel })} onClick={onCloseRecord} size="sm" icon={<X className="w-4 h-4" aria-hidden="true" />} />
            </div>
            <div role="tabpanel" id={`${id}-record-panel`} aria-labelledby={`${id}-record`} hidden={current !== 'record'}
                className="pt-2">
                {record}
            </div>
            <div role="tabpanel" id={`${id}-journal-panel`} aria-labelledby={`${id}-journal`} hidden={current !== 'journal'}>
                {journal}
            </div>
        </div>
    );
}
