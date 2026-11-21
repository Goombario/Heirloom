'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { openQuickAdd } from '@/app/components/QuickAddHost';
import { useTree } from '@/app/contexts/TreeContext';
import {
    CREATE_SHORTCUTS, GO_SHORTCUTS, OPEN_CHEATSHEET_EVENT,
    isTypingTarget, letterOf, type CreateAction, type SequencePrefix,
} from '@/lib/keyboard/shortcuts';
import { useLetterShortcuts } from './useKeyboardPrefs';
import { Cheatsheet } from './Cheatsheet';
import { Kbd } from './Kbd';

/** How long the next-key card waits for the second key. */
const SEQUENCE_MS = 1500;

/** True while a modal dialog other than our own is open: its keys are its own. */
function modalOpen(): boolean {
    // eslint-disable-next-line no-restricted-syntax -- another component's dialog has no ref here; the attribute is the shared signal
    return document.querySelector('[aria-modal="true"]') != null;
}

/**
 * The keyboard shortcuts host (#32), mounted once in the root layout. It owns the
 * `g` / `n` sequences, `?` and Ctrl/⌘ + `/` for the cheatsheet, the next-key card
 * after `g` or `n`, and the cheatsheet itself. Search (`/`, Ctrl/⌘ + K) stays in
 * GlobalSearch, and the editors keep their own Ctrl/⌘ + S.
 */
export default function KeyboardShortcuts() {
    const router = useRouter();
    const { guardNavigation } = useUnsavedChangesGuard(false);
    const { activePermission } = useTree();
    const letters = useLetterShortcuts();
    const [pending, setPending] = useState<SequencePrefix | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const onOpen = () => setSheetOpen(true);
        window.addEventListener(OPEN_CHEATSHEET_EVENT, onOpen);
        return () => window.removeEventListener(OPEN_CHEATSHEET_EVENT, onOpen);
    }, []);

    const cancel = useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        setPending(null);
    }, []);

    const go = useCallback((href: string) => {
        if (!guardNavigation()) return;
        router.push(href);
    }, [guardNavigation, router]);

    const create = useCallback((action: CreateAction) => {
        if (activePermission === 'view') return;
        if (action === 'source') go('/library/new');
        else openQuickAdd(action);
    }, [activePermission, go]);

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.defaultPrevented || e.isComposing) return;
            // Ctrl/⌘ + / always opens the list, even while typing.
            if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'Slash') {
                e.preventDefault();
                cancel();
                setSheetOpen(true);
                return;
            }
            if (!letters || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;

            if (pending) {
                e.preventDefault();
                const letter = letterOf(e.code);
                const prefix = pending;
                cancel();
                if (e.code === 'Slash' && e.shiftKey) { setSheetOpen(true); return; }
                if (!letter || e.shiftKey) return;
                if (prefix === 'g') {
                    const target = GO_SHORTCUTS.find((s) => s.letter === letter);
                    if (target) go(target.href);
                } else {
                    const target = CREATE_SHORTCUTS.find((s) => s.letter === letter);
                    if (target) create(target.action);
                }
                return;
            }

            if (sheetOpen || modalOpen()) return;
            if ((e.code === 'Slash' && e.shiftKey) || e.key === '?') {
                e.preventDefault();
                setSheetOpen(true);
                return;
            }
            const letter = letterOf(e.code);
            if (!e.shiftKey && (letter === 'g' || letter === 'n')) {
                e.preventDefault();
                setPending(letter);
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(() => { timer.current = null; setPending(null); }, SEQUENCE_MS);
            }
        }
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [letters, pending, sheetOpen, cancel, go, create]);

    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    return (
        <>
            {pending && <NextKeyCard prefix={pending} />}
            <Cheatsheet open={sheetOpen} onClose={() => setSheetOpen(false)} lettersOn={letters} />
        </>
    );
}

/** The card after `g` or `n` (#32, hint option A): the next letters, Esc, and `?`. */
function NextKeyCard({ prefix }: { prefix: SequencePrefix }) {
    const t = useTranslations('shortcuts');
    const tn = useTranslations('nav');
    const [run, setRun] = useState(false);
    // The bar empties over the wait, so the time left is visible.
    useEffect(() => { const id = requestAnimationFrame(() => setRun(true)); return () => cancelAnimationFrame(id); }, []);
    const items = prefix === 'g'
        ? GO_SHORTCUTS.map((s) => ({ letter: s.letter, label: tn(s.labelKey) }))
        : CREATE_SHORTCUTS.map((s) => ({ letter: s.letter, label: t(s.hintKey) }));
    return (
        <div role="status" aria-live="polite"
            className="hidden md:block fixed left-6 bottom-6 z-[85] w-[380px] overflow-hidden rounded-[14px] border border-border bg-card text-text shadow-lg">
            <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5">
                <Kbd strong>{prefix}</Kbd>
                <span className="flex-1 text-md font-semibold">{prefix === 'g' ? t('hint_go') : t('hint_new')}</span>
                <span className="text-meta text-text-muted">{t('hint_press')}</span>
            </div>
            <div className="h-0.5 bg-border" aria-hidden="true">
                <div className="h-0.5 bg-segment-on motion-reduce:hidden"
                    style={{ width: run ? '0%' : '100%', transition: `width ${SEQUENCE_MS}ms linear` }} />
            </div>
            <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-0.5 px-4 pt-2.5 pb-3">
                {items.map((it) => (
                    <li key={it.letter} className="flex h-7 items-center gap-2.5 text-base">
                        <Kbd>{it.letter}</Kbd><span className="truncate">{it.label}</span>
                    </li>
                ))}
            </ul>
            <div className="flex items-center gap-1.5 border-t border-border bg-card-alt px-4 py-2.5 text-meta text-text-secondary">
                <Kbd size="sm">Esc</Kbd><span>{t('hint_cancels')}</span>
                <span className="flex-1" />
                <Kbd size="sm">?</Kbd><span>{t('hint_all')}</span>
            </div>
        </div>
    );
}
