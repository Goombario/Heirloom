'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { installHistoryTraversalGuard } from './historyTraversalGuard';
import { sheetsTakeBack } from './ui/sheetStack';

type RegistrationId = string;
type NavigateEvent = { preventDefault: () => void };

interface UnsavedChangesContextValue {
    register: (id: RegistrationId, isDirty: boolean) => () => void;
    confirmNavigation: () => boolean;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

/**
 * Coordinates dirty forms across a page. Registrations are independent so a
 * citation drawer or modal cannot accidentally clear a still-dirty parent form.
 * The provider owns the single hard-unload listener; it exists only while at
 * least one registration is dirty.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
    const t = useTranslations('common');
    const [registrations, setRegistrations] = useState<Record<RegistrationId, boolean>>({});
    const register = useCallback((id: RegistrationId, isDirty: boolean) => {
        setRegistrations((current) => ({ ...current, [id]: isDirty }));
        return () => {
            setRegistrations((current) => {
                const next = { ...current };
                delete next[id];
                return next;
            });
        };
    }, []);

    const hasDirty = Object.values(registrations).some(Boolean);

    const confirmNavigation = useCallback(() => (
        !hasDirty || window.confirm(t('unsaved_changes_confirm'))
    ), [hasDirty, t]);
    const confirmNavigationRef = useRef(confirmNavigation);

    useEffect(() => {
        confirmNavigationRef.current = confirmNavigation;
    }, [confirmNavigation]);

    // Back with a sheet open closes that sheet instead of leaving the page (#1042, #1053).
    useEffect(() => installHistoryTraversalGuard(
        window,
        () => sheetsTakeBack() ?? confirmNavigationRef.current(),
    ), []);

    useEffect(() => {
        if (!hasDirty) return;
        function onBeforeUnload(event: BeforeUnloadEvent) {
            event.preventDefault();
            // Chromium still requires returnValue to be assigned for the native
            // confirmation dialog. Browsers ignore the string itself.
            event.returnValue = '';
        }
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [hasDirty]);

    const value = useMemo(() => ({ register, confirmNavigation }), [register, confirmNavigation]);
    return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>;
}

/**
 * Register one dirty state and return guards for Next's supported client-link
 * hook and imperative navigation. `onNavigate` is intentionally synchronous:
 * Next can cancel a navigation, but cannot safely replay one after an async
 * custom dialog.
 */
export function useUnsavedChangesGuard(isDirty: boolean) {
    const context = useContext(UnsavedChangesContext);
    const id = useId();
    const confirmNavigation = useMemo(() => context?.confirmNavigation ?? (() => true), [context]);
    const register = context?.register;

    useEffect(() => {
        if (!register) return;
        return register(id, isDirty);
    }, [register, id, isDirty]);

    const onNavigate = useCallback((event: NavigateEvent) => {
        if (!confirmNavigation()) {
            event.preventDefault();
            return false;
        }
        return true;
    }, [confirmNavigation]);

    const guardNavigation = useCallback(() => confirmNavigation(), [confirmNavigation]);

    return { onNavigate, guardNavigation };
}
