'use client';

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import { useTranslations } from 'next-intl';
import { ChevronLeft, X } from '@/lib/icons';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { cx } from './cx';
import { pushSheet } from './sheetStack';
import { dismissChangeToast } from './Toast';

/** A sheet's tallest: the screen less a 40px peek of the page and the notch. */
const SHEET_CAP = 'calc(100dvh - 40px - var(--sat, 0px))';
/** How long after a viewport change or blur iOS has finished moving things for the keyboard. */
const KEYBOARD_SETTLE_MS = 350;

/** Whether a text field in the sheet still has focus, so the keyboard may still be up. */
function typingInto(el: HTMLElement): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !el.contains(active)) return false;
  return active.tagName === 'TEXTAREA' || active.isContentEditable
    || (active.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes((active as HTMLInputElement).type));
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Required for a11y — backs the always-rendered Drawer.Title (sr-only when the header is hidden). */
  title: string;
  /** Hide the header row (caller renders its own header). */
  hideHeader?: boolean;
  /** Move focus into the sheet on open and back to the opener on close (#854). On by
   *  default: Vaul leaves focus on the page, and a keyboard user then Tabs through the
   *  page behind the sheet (#844). Focus lands on the header's first button (or the
   *  sheet itself), never on a text field, so opening doesn't raise the keyboard. */
  autoFocus?: boolean;
  /** Where the sheet stops rendering: below `md` (phones, the default) or below
   *  `lg` (tablets too, for a sheet that stands in for a desktop rail). */
  below?: 'md' | 'lg';
  /** `fit` (previews, menus, pickers) grows with its content up to the cap. `full` is
   *  the typing sheet: full height, 40px below the top, Return moves to the next field.
   *  `screen` is a full-screen page (the portrait crop, the journey map): no grab
   *  handle, square corners, the header below the notch. */
  size?: 'fit' | 'full' | 'screen';
  /** `dark` for a photo screen, like the crop (a `.dark-island`). */
  tone?: 'default' | 'dark';
  /** Unsaved changes. Every way out (Cancel, Back, the scrim, Esc, pulling down, the
   *  phone's Back) then springs back and asks "Discard your changes?". */
  dirty?: boolean;
  /** Shows Save (the sheet's copper pill) in the header and Cancel on the left, the
   *  typing-sheet header. Save is dim until `dirty`. When it returns a promise, the
   *  pill reads "Saving…" until it settles: a local build's save waits ~1.5 s for a
   *  durable write (#1033, #1215). */
  onSave?: () => unknown;
  /** The pill's word, e.g. "Add" (default "Save"). */
  saveLabel?: string;
  /** Keep Save dim even when dirty (a required field is empty, a save is running). */
  saveDisabled?: boolean;
  /** Save is live before anything changes: a step whose choice is already made, such
   *  as Attach once a source is picked, where every field is optional. */
  saveWhenClean?: boolean;
  /** Shows "‹ Back" instead of Cancel: a step inside the sheet that returns one level.
   *  Asks about unsaved changes first, like Cancel. */
  onBack?: () => void;
  /** Back keeps what was typed (the step it returns to holds it), so it never asks. */
  backKeepsChanges?: boolean;
  /** The discard prompt's line (default "Your changes won't be saved."). */
  discardMessage?: string;
  children: React.ReactNode;
}

/** How deep the enclosing sheets go; a sheet inside one opens with Vaul's NestedRoot. */
const SheetContext = createContext(0);

/** Three sheets deep at most (design-system.md → Mobile → Sheets). */
const MAX_DEPTH = 3;

const TEXT_FIELD = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([disabled]), textarea:not([disabled])';

/** Text fields in document order, for Return → next field. */
function textFields(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TEXT_FIELD)).filter(el => el.getAttribute('aria-hidden') !== 'true');
}

/**
 * Mobile bottom sheet built on Vaul (#1042): a header (Cancel or Back, the title,
 * Save or ✕), a body that scrolls inside a height cap (MB-2), and one closing rule for
 * every way out — a clean sheet closes at once, a dirty one springs back and asks
 * "Discard your changes?". Sheets stack three deep; pulling down or Cancel closes only
 * the top one. Renders nothing on desktop — Vaul portals escape `md:hidden`, so we gate
 * on `useIsMobile()` instead. No snap-points (that stays bespoke in MobileLightbox).
 */
export function Sheet(props: SheetProps) {
  const isMobile = useIsMobile(props.below ?? 'md');
  // Early return AFTER hooks — safe per rules-of-hooks.
  if (!isMobile) return null;
  return <SheetBody {...props} />;
}

function SheetBody({
  open, onClose, title, hideHeader, autoFocus = true, size = 'fit', tone = 'default', dirty = false,
  onSave, saveLabel, saveDisabled = false, saveWhenClean = false, onBack, backKeepsChanges = false, discardMessage, children,
}: SheetProps) {
  const tc = useTranslations('common');
  const depth = useContext(SheetContext) + 1;
  const contentRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [asking, setAsking] = useState(false);
  // An onSave promise still running (#1215).
  const [pendingSave, setPendingSave] = useState(false);
  const showSaving = pendingSave;
  const save = () => {
    if (!onSave || showSaving) return;
    const result = onSave();
    if (result instanceof Promise) {
      setPendingSave(true);
      const done = () => setPendingSave(false);
      result.then(done, done);
    }
  };
  // What "Discard" does: close the sheet, or step Back inside it.
  const pendingRef = useRef<() => void>(onClose);

  if (process.env.NODE_ENV !== 'production' && depth > MAX_DEPTH) {
    console.warn(`Sheet "${title}" is ${depth} deep; sheets stack ${MAX_DEPTH} deep at most.`);
  }

  // Vaul moved the panel (a pull) or is about to animate it away; put it back.
  const springBack = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const ease = '0.5s cubic-bezier(0.32, 0.72, 0, 1)';
    el.style.transition = `transform ${ease}`;
    el.style.transform = 'translate3d(0, 0, 0)';
    // A pull also faded the scrim; bring it back with the panel.
    const overlay = el.parentElement?.querySelector<HTMLElement>('[data-vaul-overlay]');
    if (overlay) {
      overlay.style.transition = `opacity ${ease}`;
      overlay.style.opacity = '1';
    }
  }, []);

  const attempt = useCallback((action: () => void) => {
    if (!dirty) { action(); return; }
    pendingRef.current = action;
    springBack();
    setAsking(true);
  }, [dirty, springBack]);

  const requestClose = useCallback(() => {
    if (asking) { setAsking(false); return; }
    attempt(onClose);
  }, [asking, attempt, onClose]);

  // The phone's Back closes the top sheet (sheetStack, via UnsavedChangesProvider).
  const requestCloseRef = useRef(requestClose);
  useEffect(() => { requestCloseRef.current = requestClose; }, [requestClose]);
  useEffect(() => {
    if (!open) return;
    return pushSheet({ requestClose: () => requestCloseRef.current() });
  }, [open]);

  // Remember the opener before Radix moves focus, to give focus back on close.
  useLayoutEffect(() => {
    if (open) openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);

  // A typing sheet rides the visible viewport. With the keyboard up, iOS scrolls the page
  // to bring the caret into view, which would carry the header (and Save) off the top; so
  // the sheet sits above the keyboard and 40px below whatever is visible (Vaul's own
  // keyboard fitting is off for these). Other sheets leave the keyboard to Vaul.
  //
  // Once the keyboard is gone, every sheet drops its keyboard fit, ours or Vaul's, so it
  // is back where it started (#50). iOS can send its last viewport event before it has
  // reset the scroll, or none at all, so a closing keyboard is checked again once settled.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!open || !vv) return;
    let frame = 0;
    let late = 0;
    const fit = () => {
      const el = contentRef.current;
      // Pinched in, the visible area isn't the screen; leave the sheet where it is.
      if (!el || vv.scale > 1.01) return;
      const keyboard = window.innerHeight - vv.height - vv.offsetTop;
      if (keyboard < 1 && !typingInto(el)) {
        el.style.bottom = '';
        el.style.height = size === 'full' ? SHEET_CAP : '';
        return;
      }
      if (size !== 'full') return;
      el.style.bottom = `${Math.max(0, keyboard)}px`;
      el.style.height = `calc(${vv.height}px - 40px - var(--sat, 0px))`;
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    const settle = () => {
      schedule();
      window.clearTimeout(late);
      late = window.setTimeout(schedule, KEYBOARD_SETTLE_MS);
    };
    // The panel mounts with the portal, a frame after it opens.
    schedule();
    vv.addEventListener('resize', settle);
    vv.addEventListener('scroll', settle);
    document.addEventListener('focusout', settle);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(late);
      vv.removeEventListener('resize', settle);
      vv.removeEventListener('scroll', settle);
      document.removeEventListener('focusout', settle);
    };
  }, [open, size]);

  // A clean sheet never shows the prompt.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!dirty) setAsking(false); }, [dirty]);

  const onOpenAutoFocus = (e: Event) => {
    if (!autoFocus) return; // Vaul then prevents Radix's focus move itself.
    e.preventDefault();
    const content = contentRef.current;
    const first = content?.querySelector<HTMLElement>('[data-sheet-header] button:not([disabled])');
    (first ?? content)?.focus();
  };

  const onCloseAutoFocus = (e: Event) => {
    e.preventDefault();
    const opener = openerRef.current;
    if (opener?.isConnected) opener.focus();
  };

  // Return moves to the next field; the last field keeps its default (Done).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (size !== 'full' || e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT' || target.getAttribute('aria-expanded') === 'true') return;
    const fields = contentRef.current ? textFields(contentRef.current) : [];
    const next = fields[fields.indexOf(target) + 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };
  const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    if (size !== 'full') return;
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT' || !contentRef.current) return;
    const fields = textFields(contentRef.current);
    const i = fields.indexOf(target);
    if (i >= 0 && !target.hasAttribute('enterkeyhint')) {
      target.setAttribute('enterkeyhint', i < fields.length - 1 ? 'next' : 'done');
    }
  };

  const Root = depth > 1 ? Drawer.NestedRoot : Drawer.Root;
  const typing = size === 'full' || onSave !== undefined;
  const cap = SHEET_CAP;
  const screen = size === 'screen';

  return (
    <SheetContext.Provider value={depth}>
      <Root
        open={open}
        onOpenChange={(o) => { if (!o) requestClose(); }}
        autoFocus={autoFocus}
        repositionInputs={size !== 'full'}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-70 bg-black/45" />
          <Drawer.Content
            ref={contentRef}
            data-sheet-size={size}
            onOpenAutoFocus={onOpenAutoFocus}
            onCloseAutoFocus={onCloseAutoFocus}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            className={cx(
              'fixed left-0 right-0 bottom-0 z-70 flex flex-col outline-none',
              screen ? 'top-0' : 'rounded-t-[20px] shadow-[0_-8px_24px_rgba(0,0,0,0.18)]',
              tone === 'dark' ? 'dark-island bg-[color:var(--color-lightbox-stage-bottom)]' : 'bg-card',
            )}
            style={screen ? { paddingTop: 'var(--sat, 0px)' } : size === 'full' ? { height: cap } : { maxHeight: cap }}
          >
            {!screen && <div className="w-9 h-[5px] rounded-full bg-border mx-auto mt-2 shrink-0" aria-hidden="true" />}
            {/* Vaul requires a Drawer.Title for a11y (warns otherwise) and links it
                via aria-labelledby — the sole accessible name, so no aria-label on
                Content. Always sr-only; the visible header renders its own title. */}
            <Drawer.Title className="sr-only">{title}</Drawer.Title>
            {!hideHeader && (
              <div
                data-sheet-header=""
                className={cx('grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3.5 pb-2 border-b border-border shrink-0', screen ? 'pt-2' : 'pt-1')}
              >
                <div className="justify-self-start">
                  {onBack ? (
                    <HeaderLink onClick={() => (backKeepsChanges ? onBack() : attempt(onBack))} label={tc('back')} back />
                  ) : typing ? (
                    <HeaderLink onClick={requestClose} label={tc('cancel')} />
                  ) : null}
                </div>
                <span aria-hidden="true" className="text-md font-semibold text-text text-center truncate">{title}</span>
                <div className="justify-self-end">
                  {onSave ? (
                    <button
                      type="button"
                      onClick={save}
                      disabled={(!dirty && !saveWhenClean) || saveDisabled || showSaving}
                      aria-busy={showSaving || undefined}
                      className={cx(
                        'relative inline-flex items-center min-h-[34px] px-3.5 rounded-full bg-primary text-white text-sm font-semibold cursor-pointer focus-ring',
                        'before:absolute before:-inset-[5px] before:content-[""]',
                        // Saving stays legible; only an unavailable Save dims.
                        showSaving ? 'disabled:opacity-75 disabled:cursor-wait' : 'disabled:opacity-40 disabled:cursor-default',
                      )}
                    >
                      {showSaving ? tc('saving') : saveLabel ?? tc('save')}
                    </button>
                  ) : !typing ? (
                    <button
                      type="button"
                      onClick={requestClose}
                      aria-label={tc('close')}
                      title={tc('close')}
                      className="relative grid place-items-center w-[30px] h-[30px] rounded-full bg-surface-2 text-text cursor-pointer focus-ring before:absolute before:-inset-[7px] before:content-['']"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
            )}
            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-3"
              style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
            >
              {children}
            </div>
            {asking && (
              <DiscardPrompt
                message={discardMessage}
                onDiscard={() => { setAsking(false); pendingRef.current(); }}
                onKeep={() => setAsking(false)}
              />
            )}
          </Drawer.Content>
        </Drawer.Portal>
      </Root>
    </SheetContext.Provider>
  );
}

function HeaderLink({ onClick, label, back = false }: { onClick: () => void; label: string; back?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-0.5 min-h-11 -ml-1 px-1 text-base font-medium text-link cursor-pointer rounded-lg focus-ring"
    >
      {back && <ChevronLeft className="w-[18px] h-[18px]" aria-hidden="true" />}
      {label}
    </button>
  );
}

/** The confirm card's face: a title, what goes and what stays, a red pill, an ink way back. */
function ConfirmCard({ title, body, confirmLabel, keepLabel, onConfirm, onKeep, keepRef, titleId, bodyId, busy = false }: {
  title: React.ReactNode; body: React.ReactNode; confirmLabel: string; keepLabel: string;
  onConfirm: () => void; onKeep: () => void; keepRef: React.RefObject<HTMLButtonElement | null>;
  titleId?: string; bodyId?: string; busy?: boolean;
}) {
  return (
    <div className="w-full grid gap-2.5 bg-card rounded-[20px] px-4 pt-[18px] pb-1 shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
      <h2 id={titleId} className="m-0 text-md font-semibold text-text">{title}</h2>
      <p id={bodyId} className="m-0 mb-1 text-base text-text-secondary">{body}</p>
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className="w-full min-h-11 rounded-full bg-button-danger text-white text-base font-semibold cursor-pointer focus-ring disabled:opacity-60 disabled:cursor-default"
      >
        {confirmLabel}
      </button>
      <button
        ref={keepRef}
        type="button"
        onClick={onKeep}
        className="w-full min-h-11 text-base font-semibold text-text cursor-pointer rounded-lg focus-ring"
      >
        {keepLabel}
      </button>
    </div>
  );
}

/**
 * "Discard your changes?" — a card rising from the bottom of the sheet, with the red
 * pill to discard and an ink "Keep editing" row (design-system.md → Feedback). It sits
 * inside the sheet so the sheet's focus trap holds it.
 */
function DiscardPrompt({ message, onDiscard, onKeep }: { message?: string; onDiscard: () => void; onKeep: () => void }) {
  const tc = useTranslations('common');
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { keepRef.current?.focus(); }, []);
  return (
    <div className="absolute inset-0 z-10 flex items-end p-2.5 bg-black/40 rounded-t-[20px]">
      <div role="alertdialog" aria-modal="true" aria-labelledby="sheet-discard-title" aria-describedby="sheet-discard-body" className="w-full">
        <ConfirmCard
          title={tc('discard_changes_title')}
          body={message ?? tc('discard_changes_body')}
          confirmLabel={tc('discard_changes')}
          keepLabel={tc('keep_editing')}
          onConfirm={onDiscard}
          onKeep={onKeep}
          keepRef={keepRef}
          titleId="sheet-discard-title"
          bodyId="sheet-discard-body"
        />
      </div>
    </div>
  );
}

interface ConfirmSheetProps {
  open: boolean;
  /** "Delete Greta’s birth?" */
  title: string;
  /** What goes and what stays. */
  body: React.ReactNode;
  /** The red pill: "Delete birth". */
  confirmLabel: string;
  /** The ink way back: "Keep the death". Default "Cancel". */
  keepLabel?: string;
  onConfirm: () => void;
  /** Every way out but the pill (Keep, the scrim, pulling down, Esc, the phone's Back). */
  onClose: () => void;
  busy?: boolean;
}

/**
 * The delete confirm (design-system.md → Mobile → Feedback): a card rising from the
 * bottom that names what goes and what stays, a red pill and an ink way back. Opened
 * from a sheet it stacks on top of it, so it counts toward the three-deep limit.
 * Focus starts on the way back, never on the destructive pill. Phones only.
 */
export function ConfirmSheet(props: ConfirmSheetProps) {
  const isMobile = useIsMobile('md');
  if (!isMobile) return null;
  return <ConfirmSheetBody {...props} />;
}

function ConfirmSheetBody({ open, title, body, confirmLabel, keepLabel, onConfirm, onClose, busy }: ConfirmSheetProps) {
  const tc = useTranslations('common');
  const depth = useContext(SheetContext) + 1;
  const keepRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    // The change toast sits where the card rises, over its way back.
    dismissChangeToast();
    return pushSheet({ requestClose: () => closeRef.current() });
  }, [open]);
  const Root = depth > 1 ? Drawer.NestedRoot : Drawer.Root;
  return (
    <SheetContext.Provider value={depth}>
      <Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-70 bg-black/40" />
          <Drawer.Content
            role="alertdialog"
            onOpenAutoFocus={(e) => { e.preventDefault(); keepRef.current?.focus(); }}
            className="fixed left-0 right-0 bottom-0 z-70 px-2.5 outline-none"
            style={{ paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))' }}
          >
            <ConfirmCard
              title={<Drawer.Title asChild><span>{title}</span></Drawer.Title>}
              body={<Drawer.Description asChild><span>{body}</span></Drawer.Description>}
              confirmLabel={confirmLabel}
              keepLabel={keepLabel ?? tc('cancel')}
              onConfirm={onConfirm}
              onKeep={onClose}
              keepRef={keepRef}
              busy={busy}
            />
          </Drawer.Content>
        </Drawer.Portal>
      </Root>
    </SheetContext.Provider>
  );
}
