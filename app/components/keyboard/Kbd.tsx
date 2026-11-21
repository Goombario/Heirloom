import type { ReactNode } from 'react';
import { cx } from '@/app/components/ui';

/**
 * One key as the shortcuts show it (#32): a small keycap. `strong` is the filled
 * key that starts a sequence on the next-key card.
 */
export function Kbd({ children, size = 'md', strong = false }: { children: ReactNode; size?: 'sm' | 'md'; strong?: boolean }) {
    return (
        <kbd className={cx(
            'inline-flex shrink-0 items-center justify-center rounded-md font-sans font-semibold leading-none',
            strong
                ? 'h-[30px] min-w-[30px] px-2 text-base bg-segment-on text-on-segment'
                : cx('border border-b-2 border-border bg-card-alt text-text', size === 'sm' ? 'h-5 min-w-5 px-1.5 text-xs' : 'h-6 min-w-6 px-[7px] text-meta'),
        )}>
            {children}
        </kbd>
    );
}
