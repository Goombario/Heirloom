'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, CheckCircle2, Info } from '@/lib/icons';

/**
 * The app's transient-notification surface. This file is the ONLY importer of
 * `sonner` — sonner owns the behaviour that is easy to get subtly wrong (queue,
 * timers, hover-pause, swipe-dismiss, aria-live, reduced-motion) and we own only
 * the appearance, so the dependency stays swappable.
 *
 * Tones reuse `ui/Banner`'s vocabulary so toasts and inline banners read as one
 * system. The error tone always pairs its tint with an icon: colour is never the
 * sole signal.
 *
 * Position is `top-center` at every breakpoint. Bottom-anchored toasts collide
 * with the sticky bottom action bars on `FormTopBar`, and
 * sonner takes a single position — a responsive override would mean reaching
 * into its container element. The change toast (`showChangeToast`, #1043) is the
 * one bottom card: it has its own toaster, for the redesigned mobile screens.
 *
 * No `theme` prop: with `unstyled` the colours come from our CSS variables, which
 * already resolve per theme via the `html.dark` class.
 */

export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** Fire a transient error toast. `message` MUST already be translated. */
export function showErrorToast(message: string): void {
  toast.error(message);
}

/**
 * Fire a transient success toast (e.g. "Tagged 3 people"), optionally with an
 * action button (e.g. Undo). `message` and `action.label` MUST already be
 * translated.
 */
export function showSuccessToast(message: string, action?: ToastAction): void {
  toast.success(message, action ? { action } : undefined);
}

/** Fire a transient, neutral informational toast. `message` MUST already be translated. */
export function showInfoToast(message: string, action?: ToastAction): void {
  toast.info(message, action ? { action } : undefined);
}

const CHANGE_TOASTER = 'change';
const CHANGE_TOAST = 'change';
const UNDO_MS = 6000;
const DONE_MS = 2000;
let changeSeq = 0;

interface ChangeToastOptions {
  /** What changed, already translated ("Birth deleted"). */
  message: string;
  /** A second line with what it was ("1900 · Duluth"). */
  detail?: string;
  /** Takes the change back. Without it the toast is a plain confirmation: a tick,
   *  no Undo, gone after 2 seconds (also how contributors, who can't undo, see it). */
  onUndo?: () => void;
}

/**
 * The bottom card for a change (#1043, design-system.md → Mobile → Feedback). With
 * `onUndo` it offers Undo for 6 seconds, with a time bar that pauses while a finger
 * rests on the card or Undo has focus. One at a time: a new one replaces the old,
 * and the earlier change stays made. A swipe sideways or down dismisses it early;
 * dismissing never undoes, only the button does.
 */
export function showChangeToast({ message, detail, onUndo }: ChangeToastOptions): void {
  const seq = ++changeSeq;
  toast.custom(
    (id) => <ChangeToastCard key={seq} toastId={id} message={message} detail={detail} onUndo={onUndo} />,
    { id: CHANGE_TOAST, toasterId: CHANGE_TOASTER, duration: Infinity, unstyled: true },
  );
}

/** Puts the change card away early, e.g. when a confirm rises where it sits. The change stays made. */
export function dismissChangeToast(): void {
  toast.dismiss(CHANGE_TOAST);
}

function ChangeToastCard({ toastId, message, detail, onUndo }: ChangeToastOptions & { toastId: string | number }) {
  const t = useTranslations('common');
  const total = onUndo ? UNDO_MS : DONE_MS;
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = touched || focused;
  const remaining = useRef(total);

  // Our own timer (sonner's is off), so the bar and the dismissal stay in step.
  useEffect(() => {
    if (held) return;
    const start = Date.now();
    const timer = setTimeout(() => toast.dismiss(toastId), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - start));
    };
  }, [held, toastId]);

  return (
    <div
      className="change-toast relative flex w-full min-h-[50px] items-center gap-2 overflow-hidden rounded-[14px] pl-3.5 pr-1 font-sans text-base font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
      onPointerDown={() => setTouched(true)}
      onPointerUp={() => setTouched(false)}
      onPointerCancel={() => setTouched(false)}
      onPointerLeave={() => setTouched(false)}
    >
      <span className="flex-1 min-w-0 py-2.5 leading-snug">
        {!onUndo && <Check className="inline-block w-4 h-4 mr-1.5 -mt-0.5 change-toast-action" aria-hidden="true" />}
        {message}
        {detail && <small className="block mt-px text-sm font-normal opacity-75">{detail}</small>}
      </span>
      {onUndo && (
        <button
          type="button"
          className="change-toast-action shrink-0 min-h-11 min-w-16 px-3 rounded-[10px] text-md font-bold cursor-pointer focus-ring active:bg-current/10"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onClick={() => { toast.dismiss(toastId); onUndo(); }}
        >
          {t('undo')}
        </button>
      )}
      {onUndo && (
        <span
          aria-hidden="true"
          className="change-toast-bar"
          style={{ animationDuration: `${total}ms`, animationPlayState: held ? 'paused' : 'running' }}
        />
      )}
    </div>
  );
}

/** Keeps the change toast above the on-screen keyboard (`--kb-inset`). */
function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--kb-inset', `${Math.round(inset)}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--kb-inset');
    };
  }, []);
}

const CHANGE_BOTTOM = 'calc(14px + env(safe-area-inset-bottom, 0px) + var(--kb-inset, 0px))';

export function AppToaster() {
  const t = useTranslations('common');
  useKeyboardInset();
  return (
    <>
      <Toaster
        id={CHANGE_TOASTER}
        position="bottom-center"
        visibleToasts={1}
        offset={{ bottom: CHANGE_BOTTOM }}
        mobileOffset={{ bottom: CHANGE_BOTTOM, left: '10px', right: '10px' }}
        swipeDirections={['left', 'right', 'bottom']}
        containerAriaLabel={t('change_toasts_label')}
      />
      <Toaster
        position="top-center"
        // Clears the sticky nav (3.5rem + the top safe-area inset) plus a gap.
        // `offset` alone is NOT enough: under 600px sonner switches to `mobileOffset`
        // (default 16px), which parked the toast on top of the nav at 390px.
        //
        // Both MUST be the object form. A bare string/number is assigned to all four
        // sides (sonner's `assignOffset`), and on mobile the toast's width is
        // `calc(100% - var(--mobile-offset-left) * 2)` — so a string here made the
        // horizontal inset the NAV HEIGHT, collapsing the toast to a ~136px sliver on
        // a notched 390px viewport. The object form leaves the other three sides at
        // sonner's defaults (24px desktop / 16px mobile).
        // max() keeps toasts off the notch where --nav-h is 0 (the phone record heroes, #1099).
        offset={{ top: 'calc(max(var(--nav-h), var(--sat)) + 0.75rem)' }}
        mobileOffset={{ top: 'calc(max(var(--nav-h), var(--sat)) + 0.75rem)' }}
        duration={6000}
        closeButton
        containerAriaLabel={t('error_toasts_label')}
        icons={{
          error: <AlertTriangle size={18} aria-hidden="true" />,
          success: <CheckCircle2 size={18} aria-hidden="true" />,
          info: <Info size={18} aria-hidden="true" />,
        }}
        toastOptions={{
          closeButtonAriaLabel: t('error_toast_close'),
          unstyled: true,
          classNames: {
            // `font-sans` is ours: sonner hardcodes its own `ui-sans-serif` stack on
            // `[data-sonner-toaster]`, so without this the toast is the one surface in
            // the app not set in Inter.
            //
            // The `[data-expanded=false][data-front=false]` child rule restores stack
            // collapsing that `unstyled` switches off: sonner clamps rear toasts to the
            // front toast's height unconditionally, but gates hiding their content on
            // `data-styled=true`. Without it, two toasts inside the 6s window overlap
            // at full opacity.
            toast:
              'relative flex w-full items-center gap-2.5 rounded-xl border py-3 pl-3.5 pr-14 text-sm font-sans shadow-lg ' +
              '[&[data-expanded=false][data-front=false]>*]:opacity-0',
            // Use the canonical `--color-*` token names, NOT the `--error` / `--error-bg`
            // aliases: sonner sets its own `--error-bg` (and siblings) on
            // `[data-sonner-toaster]`, which shadows ours for everything inside the
            // portal. That collision left the toast on sonner's light `#FFF0F0` in dark
            // theme — 2.5:1 against our `--color-error` text. The `--color-*` names are
            // ours alone and resolve per theme via `html.dark`.
            error:
              'bg-[color:var(--color-error-bg)] border-[color:var(--color-error)] text-[color:var(--color-error)]',
            // success/info reuse the same `--color-*` isolation as error, above.
            success:
              'bg-[color:var(--color-success-bg)] border-[color:var(--color-success)] text-[color:var(--color-success)]',
            info:
              'bg-[color:var(--color-info-bg)] border-[color:var(--color-info-text)] text-[color:var(--color-info-text)]',
            icon: 'shrink-0',
            title: 'flex-1 min-w-0 font-medium',
            // `text-current` + `border-current`: the action button inherits whichever
            // tone (error/success/info) the toast is, without a fourth hardcoded palette.
            actionButton:
              'ml-auto shrink-0 rounded-lg border border-current/30 bg-transparent px-2.5 py-1.5 ' +
              'text-xs font-semibold text-current transition-colors hover:bg-current/10 ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current',
            closeButton:
              'absolute right-1.5 top-1/2 -translate-y-1/2 grid h-11 w-11 place-items-center rounded-lg ' +
              'cursor-pointer transition-colors hover:bg-[color:var(--color-hover-surface)] ' +
              'focus-ring',
          },
        }}
      />
    </>
  );
}
