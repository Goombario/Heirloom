'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDocumentScrollLock } from '@/app/hooks/useDocumentScrollLock';

interface ModalProps {
    open: boolean;
    onClose: () => void;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    disableClose?: boolean;
    labelledBy?: string;
    describedBy?: string;
    /** When true, portals the overlay to document.body at z-[80] so it renders
     *  above stacking contexts such as the mobile lightbox (z-60) and Vaul
     *  drawer (z-66). Default false — all existing callers are unaffected. */
    elevated?: boolean;
    children: React.ReactNode;
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
};

export default function Modal({
    open,
    onClose,
    size = 'md',
    disableClose = false,
    labelledBy,
    describedBy,
    elevated = false,
    children,
}: ModalProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    const previouslyFocused = useRef<HTMLElement | null>(null);

    // Esc to close (unless disabled).
    useEffect(() => {
        if (!open) return;
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape' && !disableClose) {
                e.stopPropagation();
                onClose();
            }
        }
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, disableClose, onClose]);

    useDocumentScrollLock(open);

    // Focus into the dialog on open; restore focus on close.
    useEffect(() => {
        if (!open) return;
        previouslyFocused.current = document.activeElement as HTMLElement | null;
        // Move focus to the first focusable element in the card, else the card.
        const card = cardRef.current;
        const focusable = card?.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        (focusable ?? card)?.focus();
        return () => { previouslyFocused.current?.focus?.(); };
    }, [open]);

    // Focus trap: keep Tab cycling within the card.
    function onKeyDownTrap(e: React.KeyboardEvent) {
        if (e.key !== 'Tab') return;
        const card = cardRef.current;
        if (!card) return;
        const items = card.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    if (!open) return null;

    const overlay = (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            className={`fixed inset-0 bg-black/50 flex items-center justify-center p-4 animate-backdrop-in ${elevated ? 'z-80 pointer-events-auto' : 'z-50'}`}
            onClick={(e) => {
                // Only a click whose mousedown+mouseup both land on the backdrop
                // (target === currentTarget) closes. A drag that starts on the card
                // and releases on the backdrop produces no backdrop click, so it
                // will not close the modal.
                if (e.target === e.currentTarget && !disableClose) onClose();
            }}
            onKeyDown={onKeyDownTrap}
        >
            <div
                ref={cardRef}
                tabIndex={-1}
                className={`w-full ${SIZE_CLASS[size]} animate-modal-in outline-none`}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );

    if (elevated && typeof document !== 'undefined') {
        return createPortal(overlay, document.body);
    }
    return overlay;
}
