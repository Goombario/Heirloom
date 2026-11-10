'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { PageShell } from '@/app/components/ui';

/**
 * The sign-in and auth error pages (#1129): a title page like the first page of a printed
 * family history. An italic "A family history", the title in serif, a short copper rule,
 * then one sentence. The pocket-watch drawing sits cut off at the left edge behind it.
 * The action and a small fine-print line sit at the bottom. Phone first; wider screens
 * keep the same page in a narrow centred column.
 */
export function AuthTitlePage({ title, small = false, body, error, action, fine, colophon }: {
    title: ReactNode;
    /** The error page's two-line title is set smaller than the name. */
    small?: boolean;
    body: ReactNode;
    /** A plain-words problem with an orange edge, under the sentence. */
    error?: ReactNode;
    action: ReactNode;
    fine?: ReactNode;
    /** The muted version, source and licence line at the very bottom (#1256). */
    colophon?: ReactNode;
}) {
    const t = useTranslations('auth');
    return (
        <PageShell variant="workspace" className="!bg-card relative overflow-hidden flex flex-col !min-h-dvh">
            <div className="relative flex-1 flex flex-col w-full max-w-[440px] mx-auto px-7 pt-[var(--sat)] pb-[calc(28px+env(safe-area-inset-bottom,0px))]">
                {/* Anchored to the column, so on a wide screen the drawing still sits
                    just behind the words; on a phone the column is the screen. */}
                <span className="auth-watch" aria-hidden="true" />
                <div className="relative flex-1 flex flex-col justify-center py-10">
                    <span className="serif italic text-md text-text-muted">{t('eyebrow')}</span>
                    <h1 className={small ? 'auth-title auth-title-sm mt-1.5' : 'auth-title mt-1.5'}>{title}</h1>
                    <span className="block w-14 h-0.5 bg-primary mt-[22px] mb-[18px]" aria-hidden="true" />
                    <p className="m-0 max-w-[30ch] serif text-lg leading-normal text-text-secondary">{body}</p>
                    {error && (
                        <p role="alert" className="m-0 mt-3.5 border-l-[3px] border-warning-edge py-0.5 pl-3 text-sm text-text-secondary [&_b]:text-warning-text">
                            {error}
                        </p>
                    )}
                </div>
                <div className="relative">{action}</div>
                {fine && <p className="relative m-0 mt-3.5 text-meta text-text-muted">{fine}</p>}
                {colophon && <p className="relative m-0 mt-5 text-meta text-text-muted">{colophon}</p>}
            </div>
        </PageShell>
    );
}
