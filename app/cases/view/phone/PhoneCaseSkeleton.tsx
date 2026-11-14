'use client';

import { useTranslations } from 'next-intl';
import { GlassButton, PageShell, cx } from '@/app/components/ui';
import { Skeleton } from '@/app/components/SkeletonLoader';
import { Menu } from '@/lib/icons';
import { openAppMenu } from '@/app/components/nav/appEvents';
import { useHeroHeader } from '@/app/people/view/mobile/useHeroHeader';

/**
 * The phone case page while it loads (#135): the band (the menu works already), the
 * lead switcher, the two tabs and a record's claims, so the page settles in place.
 */
export function PhoneCaseSkeleton() {
    const tn = useTranslations('nav');
    useHeroHeader();
    return (
        <PageShell variant="detail" busy contentClassName="hidden" topBar={(
            <div className="mp-root md:hidden overflow-x-clip" data-testid="mobile-case-skeleton">
                <div className="hero-dark mp-slim-bar !rounded-none !shadow-none grid gap-2.5 !pl-4 !pr-3 !pb-[18px]"
                    style={{ paddingTop: 'calc(8px + var(--mp-sat))' }}>
                    <div className="flex justify-between -ml-1">
                        <GlassButton label={tn('toggle_menu')} icon={<Menu />} onClick={openAppMenu} />
                        <span aria-hidden="true" className="w-[34px] h-[34px] rounded-full bg-black/[0.38] border border-[color:var(--color-glass-border)]" />
                    </div>
                    <Skeleton className="h-3 w-[56%]" />
                    <Skeleton className="h-7 w-[82%]" />
                </div>
                <div aria-hidden="true" className="flex items-center gap-3 min-h-[62px] px-4 bg-card border-b border-border">
                    <Skeleton className="w-2.5 h-2.5 rounded-full" />
                    <div className="grid gap-1.5 flex-1"><Skeleton className="h-2.5 w-28" /><Skeleton className="h-4 w-[70%]" /></div>
                    <Skeleton className="h-3.5 w-14" />
                </div>
                <div aria-hidden="true" className="flex gap-5 items-center h-11 px-4 bg-[color:var(--surface)] border-b border-border">
                    <Skeleton className="h-3.5 w-12" /><Skeleton className="h-3.5 w-20" />
                </div>
                <div aria-hidden="true" className="mt-[42px] bg-card border-y border-border">
                    <div className="flex items-center gap-3 px-4 py-3"><Skeleton className="w-[34px] h-[34px] rounded-[10px]" /><div className="grid gap-1.5 flex-1"><Skeleton className="h-4 w-[80%]" /><Skeleton className="h-3 w-[40%]" /></div></div>
                    {[0, 1].map((i) => (
                        <div key={i} className={cx('grid gap-2 px-4 pt-2.5 pb-3 border-t border-border')}>
                            <Skeleton className="h-3.5 w-[60%]" /><Skeleton className="h-[38px] w-full rounded-[11px]" />
                        </div>
                    ))}
                </div>
            </div>
        )} />
    );
}
