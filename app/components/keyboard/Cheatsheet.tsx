'use client';

import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import GuardedLink from '@/app/components/GuardedLink';
import { DialogHeader } from '@/app/components/ui';
import { Keyboard, Search } from '@/lib/icons';
import { cheatsheet, type CheatGroup, type KeyToken } from '@/lib/keyboard/shortcuts';
import { Kbd } from './Kbd';
import { useIsMac } from './useKeyboardPrefs';

/**
 * The keyboard shortcuts list (#32, cheatsheet option A): a centred two-column
 * dialog with a filter box. Go to fills the left column; Create, Anywhere, While
 * editing and Photo viewer the right. The footer says whether letter shortcuts are
 * on and links to Options › Keyboard.
 */
export function Cheatsheet({ open, onClose, lettersOn }: { open: boolean; onClose: () => void; lettersOn: boolean }) {
    const t = useTranslations('shortcuts');
    const tn = useTranslations('nav');
    const titleId = useId();
    const filterId = useId();
    const [filter, setFilter] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const mac = useIsMac();
    const mod = mac ? '⌘' : 'Ctrl';

    // The filter box takes focus once the dialog has placed its own.
    useEffect(() => {
        if (!open) return;
        const id = requestAnimationFrame(() => inputRef.current?.focus());
        return () => cancelAnimationFrame(id);
    }, [open]);

    const groups = useMemo(() => {
        const q = filter.trim().toLocaleLowerCase();
        const label = (r: CheatGroup['rows'][number]) => (r.labelNs === 'nav' ? tn(r.labelKey) : t(r.labelKey));
        return cheatsheet(mac)
            .map((g) => ({ ...g, rows: g.rows.filter((r) => !q || label(r).toLocaleLowerCase().includes(q)).map((r) => ({ ...r, label: label(r) })) }))
            .filter((g) => g.rows.length > 0);
    }, [filter, mac, t, tn]);
    // Each opening starts with an empty filter.
    const close = () => { setFilter(''); onClose(); };
    const left = groups.filter((g) => g.id === 'go');
    const right = groups.filter((g) => g.id !== 'go');

    const sep = (s: Extract<KeyToken, { sep: string }>['sep']) => (s === 'plus' ? '+' : t(s === 'then' ? 'key_then' : 'key_or'));
    const column = (list: typeof groups) => (
        <div className="min-w-0">
            {list.map((g) => (
                <section key={g.id} aria-labelledby={`${titleId}-${g.id}`}>
                    <h3 id={`${titleId}-${g.id}`} className="eyebrow m-0 mt-4 mb-1.5">{t(g.titleKey)}</h3>
                    <dl className="m-0">
                        {g.rows.map((r) => (
                            <div key={r.id} className={`flex min-h-[30px] items-center gap-3 border-b border-border-light text-base ${r.letters && !lettersOn ? 'opacity-60' : ''}`}>
                                <dt className="flex-1 min-w-0">{r.label}</dt>
                                <dd className="m-0 flex items-center gap-1.5">
                                    {r.keys.map((k, i) => (
                                        <Fragment key={i}>
                                            {'key' in k ? <Kbd>{k.key}</Kbd> : <span className="text-meta text-text-muted">{sep(k.sep)}</span>}
                                        </Fragment>
                                    ))}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </section>
            ))}
        </div>
    );

    return (
        <Modal open={open} onClose={close} size="xl" labelledBy={titleId}>
            <div className="max-h-[calc(100dvh-4rem)] flex flex-col bg-card rounded-2xl shadow-xl border border-border">
                <div className="px-7 pt-6 pb-4">
                    <DialogHeader title={t('title')} titleId={titleId} subtitle={t('subtitle')} onClose={close} />
                </div>
                <div className="px-7 pb-4">
                    <label htmlFor={filterId} className="sr-only">{t('filter')}</label>
                    <div className="relative">
                        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                        <input ref={inputRef} id={filterId} type="search" value={filter} onChange={(e) => setFilter(e.target.value)}
                            placeholder={t('filter')} autoComplete="off"
                            className="input-nozoom h-10 w-full rounded-full border border-border bg-card-alt pl-9 pr-3.5 text-base text-text placeholder:text-text-muted focus-ring" />
                    </div>
                </div>
                <div className="min-h-0 overflow-y-auto border-t border-border px-7 pt-1 pb-5">
                    {groups.length === 0
                        ? <p className="m-0 mt-4 text-sm text-text-muted">{t('no_match')}</p>
                        : <div className="grid gap-x-10 md:grid-cols-2">{column(left)}{column(right)}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2 rounded-b-[inherit] border-t border-border bg-card-alt px-7 py-3.5 text-sm text-text-secondary">
                    <Keyboard aria-hidden="true" className="h-4 w-4" />
                    <span className="flex-1 min-w-0">{lettersOn ? t('footer_on', { mod }) : t('footer_off', { mod })}</span>
                    <GuardedLink href="/options#keyboard" onNavigate={close} className="text-link font-medium hover:underline focus-ring rounded-sm">{t('footer_link')}</GuardedLink>
                </div>
            </div>
        </Modal>
    );
}
