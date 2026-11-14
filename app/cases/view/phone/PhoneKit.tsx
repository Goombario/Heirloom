'use client';

import type { ReactNode } from 'react';
import { cx } from '@/app/components/ui';
import { Check, ChevronRight } from '@/lib/icons';

/** A section eyebrow on the phone case page, with an optional count and a text action at the end. */
export function Eyebrow({ children, count, action }: {
    children: ReactNode;
    count?: number;
    action?: { label: string; icon?: ReactNode; onClick: () => void };
}) {
    return (
        <div className="flex items-center gap-2.5 px-4 pt-[18px] pb-2">
            <h2 className="eyebrow m-0 flex items-baseline gap-1.5">
                {children}
                {count != null && <span className="font-mono font-normal tracking-normal">{count}</span>}
            </h2>
            {action && (
                <button type="button" onClick={action.onClick}
                    className="ml-auto inline-flex items-center gap-1 min-h-11 -my-3 bg-transparent border-0 p-0 text-sm font-semibold text-link cursor-pointer focus-ring rounded-sm">
                    {action.icon}{action.label}
                </button>
            )}
        </div>
    );
}

/**
 * A row in a phone case sheet: an icon tile or a lead's status dot, a label with an
 * optional second line, and a tick, a chevron or a count at the end.
 */
export function SheetRow({ icon, dot, label, sub, end, current, tone = 'default', divided = true, disabled, onClick, serif }: {
    icon?: ReactNode;
    dot?: ReactNode;
    label: ReactNode;
    sub?: ReactNode;
    end?: 'chevron' | ReactNode;
    /** The row for where the page is now: shaded and ticked. */
    current?: boolean;
    tone?: 'default' | 'danger';
    divided?: boolean;
    disabled?: boolean;
    onClick: () => void;
    /** A lead's name, set in the serif. */
    serif?: boolean;
}) {
    return (
        <button type="button" onClick={onClick} disabled={disabled} aria-current={current || undefined}
            className={cx('flex w-full items-center gap-3 min-h-14 px-4 py-2.5 bg-transparent border-0 text-left cursor-pointer active:bg-surface-2 focus-ring-inset disabled:cursor-default',
                divided && 'border-t border-border', current && 'bg-surface-2', tone === 'danger' ? 'text-error' : 'text-text')}>
            {dot && <span className="grid place-items-center w-[34px] shrink-0">{dot}</span>}
            {icon && (
                <span aria-hidden="true" className={cx('grid place-items-center w-[34px] h-[34px] shrink-0 rounded-[10px] [&_svg]:w-[17px] [&_svg]:h-[17px]',
                    tone === 'danger' ? 'bg-error-bg text-error' : 'bg-surface-2 text-text', disabled && 'opacity-50')}>{icon}</span>
            )}
            <span className={cx('grid gap-0.5 flex-1 min-w-0', disabled && 'opacity-50')}>
                <span className={cx('break-words', serif ? 'serif font-semibold text-md leading-snug' : 'text-base font-semibold')}>{label}</span>
                {sub && <small className={cx('text-meta', tone === 'danger' ? 'text-error' : 'text-text-muted')}>{sub}</small>}
            </span>
            {current && <Check className="w-[18px] h-[18px] shrink-0 text-text" aria-hidden="true" />}
            {end === 'chevron' ? <ChevronRight className="w-[18px] h-[18px] shrink-0 text-text-muted" aria-hidden="true" /> : end}
        </button>
    );
}
