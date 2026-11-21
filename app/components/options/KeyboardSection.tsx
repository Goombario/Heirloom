'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Card, cx } from '@/app/components/ui';
import { Keyboard } from '@/lib/icons';
import { Kbd } from '@/app/components/keyboard/Kbd';
import { openCheatsheet, writeLetterShortcuts } from '@/lib/keyboard/shortcuts';
import { useIsMac, useLetterShortcuts } from '@/app/components/keyboard/useKeyboardPrefs';

/**
 * Options › Keyboard (#32): the "Letter shortcuts" switch, on by default. Turning it
 * off stops every character shortcut (`g`/`n` sequences, `?`, `/`, `t`), as WCAG
 * 2.1.4 asks; Ctrl/⌘ shortcuts and Esc always work.
 */
export default function KeyboardSection() {
    const t = useTranslations('shortcuts');
    const labelId = useId();
    const descId = useId();
    const on = useLetterShortcuts();
    const mod = useIsMac() ? '⌘' : 'Ctrl';
    const toggle = () => writeLetterShortcuts(!on);
    const k = (key: string) => <Kbd size="sm">{key}</Kbd>;

    return (
        <Card id="keyboard" pad={false} className="p-6">
            <h2 className="section text-text mb-1">{t('options_title')}</h2>
            <p className="m-0 mb-4 text-sm text-text-muted">{t('options_subtitle')}</p>
            <div className="flex items-start gap-5 border-t border-border py-4">
                <div className="flex-1 min-w-0">
                    <span id={labelId} className="block text-base font-semibold text-text">{t('letters_label')}</span>
                    <p id={descId} className="m-0 mt-1 text-sm leading-relaxed text-text-secondary">
                        {t.rich('letters_desc', { g: () => k('g'), p: () => k('p'), n: () => k('n'), f: () => k('f'), q: () => k('?'), s: () => k('/'), t: () => k('t') })}
                    </p>
                </div>
                <button type="button" role="switch" aria-checked={on} aria-labelledby={labelId} aria-describedby={descId} onClick={toggle}
                    className={cx('relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors motion-reduce:transition-none focus-ring', on ? 'bg-segment-on' : 'bg-text-muted')}>
                    <span aria-hidden="true" className={cx(
                        'absolute top-[3px] left-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-transform motion-reduce:transition-none',
                        on && 'translate-x-5',
                    )} />
                </button>
            </div>
            {!on && (
                <p role="status" className="m-0 mb-4 rounded-[10px] border border-border bg-card-alt px-3.5 py-3 text-meta text-text-secondary">
                    {t.rich('letters_off_note', { mod: () => k(mod), slash: () => k('/') })}
                </p>
            )}
            <div className="border-t border-border py-4">
                <span className="block text-base font-semibold text-text">{t('always_label')}</span>
                <p className="m-0 mt-1 text-sm leading-relaxed text-text-secondary">
                    {t.rich('always_desc', { mod: () => k(mod), esc: () => k('Esc') })}
                </p>
            </div>
            <div className="border-t border-border pt-4">
                <Button variant="outline" size="md" icon={<Keyboard className="h-4 w-4" aria-hidden="true" />} onClick={openCheatsheet}>{t('show_all')}</Button>
            </div>
        </Card>
    );
}
