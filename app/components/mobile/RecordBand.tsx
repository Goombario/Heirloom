'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { GlassButton, cx } from '@/app/components/ui';
import { ArrowUpRight, Menu, Pencil } from '@/lib/icons';
import { openAppMenu } from '@/app/components/nav/appEvents';
import { useHeroHeader } from '@/app/people/view/mobile/useHeroHeader';

/**
 * The record page band on phones (#1119 source and repository pages, #1123 case page):
 * a dark band with the menu and pencil glass buttons, an eyebrow, the serif title and one
 * line under it. Light mode draws it in slate (`mp-slim-bar`); dark keeps the hero
 * gradient. Once it scrolls away a slim bar with the menu, the title and the pencil takes
 * the top edge. The top-left button is always the menu, never Back (the owner's rule; the
 * phone's own Back goes back). Renders inside `.mp-root`, which owns the page.
 */
export function RecordBand({ eyebrow, title, line, onEdit, editLabel, children }: {
    eyebrow: React.ReactNode;
    title: string;
    line?: React.ReactNode;
    /** The pencil; left out for viewers. */
    onEdit?: () => void;
    editLabel: string;
    /** Extra content under the line (the case page's background). */
    children?: React.ReactNode;
}) {
    const tn = useTranslations('nav');
    useHeroHeader();
    const bandRef = useRef<HTMLElement>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const [barShown, setBarShown] = useState(false);
    useEffect(() => {
        const update = () => {
            const band = bandRef.current, bar = barRef.current;
            if (!band || !bar) return;
            setBarShown(band.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom);
        };
        update();
        window.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
    }, []);

    return (
        <>
            <header ref={bandRef} className="hero-dark mp-slim-bar !rounded-none !shadow-none grid gap-2.5 !pl-4 !pr-3 !pb-[18px]"
                style={{ paddingTop: 'calc(8px + var(--mp-sat))' }}>
                <div className="flex justify-between -ml-1">
                    <GlassButton label={tn('toggle_menu')} icon={<Menu />} onClick={openAppMenu} />
                    {onEdit && <GlassButton label={editLabel} icon={<Pencil />} onClick={onEdit} />}
                </div>
                <div className="eyebrow inline-flex items-center gap-[7px] !text-white/70 [&_svg]:w-3.5 [&_svg]:h-3.5">{eyebrow}</div>
                <h1 className="m-0 serif font-semibold text-white text-2xl leading-[1.15] tracking-[-0.01em] text-balance [overflow-wrap:anywhere]">{title}</h1>
                {line && <div className="text-sm leading-snug text-white/75">{line}</div>}
                {children}
            </header>
            <div ref={barRef} aria-hidden={!barShown} inert={!barShown}
                className={cx('hero-dark mp-slim-bar !rounded-none !shadow-none fixed inset-x-0 z-30 flex items-center gap-2.5 !px-3 !pb-[7px] transition-[opacity,transform,visibility] duration-[180ms] motion-reduce:transition-none',
                    barShown ? 'opacity-100 translate-y-0' : 'invisible opacity-0 -translate-y-2 pointer-events-none')}
                style={{ top: 'var(--nav-h)', minHeight: 'var(--mp-bar-h)', paddingTop: 'calc(7px + var(--mp-sat))' }}>
                <BarIcon label={tn('toggle_menu')} onClick={openAppMenu}><Menu aria-hidden="true" /></BarIcon>
                <span className="flex-1 min-w-0 truncate serif font-semibold text-md text-white">{title}</span>
                {onEdit ? <BarIcon label={editLabel} onClick={onEdit}><Pencil aria-hidden="true" /></BarIcon> : <span className="w-[30px] shrink-0" />}
            </div>
        </>
    );
}

function BarIcon({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick} aria-label={label} title={label}
            className="relative grid place-items-center w-[30px] h-[30px] shrink-0 text-white cursor-pointer before:absolute before:-inset-[7px] before:content-[''] focus-ring [&_svg]:w-[18px] [&_svg]:h-[18px]">
            {children}
        </button>
    );
}

/** A quiet detail row: the label left, the value right; with `href` or `onClick` it leaves (↗). */
export function QuietRow({ label, children, mono, href, onClick, divided = true }: {
    label: string;
    children: React.ReactNode;
    mono?: boolean;
    href?: string;
    onClick?: () => void;
    divided?: boolean;
}) {
    const cls = cx('flex items-baseline gap-3.5 min-h-[46px] px-4 py-[11px] text-left w-full', divided && 'border-t border-border',
        (href || onClick) && 'cursor-pointer active:bg-surface-2 focus-ring-inset no-underline');
    const body = (
        <>
            <span className="w-[92px] shrink-0 text-sm text-text-muted">{label}</span>
            <span className={cx('flex-1 min-w-0 [overflow-wrap:anywhere]', mono ? 'font-mono text-sm text-text' : 'text-base text-text', href && !onClick && 'text-link')}>{children}</span>
            {(href || onClick) && <ArrowUpRight className="w-[15px] h-[15px] shrink-0 self-center text-text-muted" aria-hidden="true" />}
        </>
    );
    if (href) return <a href={href} className={cls} {...(/^https?:/i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{body}</a>;
    if (onClick) return <button type="button" onClick={onClick} className={cls}>{body}</button>;
    return <div className={cls}>{body}</div>;
}
