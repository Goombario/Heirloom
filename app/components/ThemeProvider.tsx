/* eslint-disable react-hooks/set-state-in-effect */
// ^ This rule is disabled because we intentionally use setState in effects to:
// 1. Detect when component has mounted (to avoid hydration mismatches)
// 2. Update resolvedTheme based on system preferences after hydration

'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Mark the page light or dark. The dark palette in globals.css hangs off
 * `html.dark` alone, so "system" is resolved here (and in the layout's pre-paint
 * script) rather than by a second copy of the palette in a media query (#2).
 */
function applyThemeClass(resolved: 'light' | 'dark') {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.classList.toggle('light', resolved === 'light');
}

function getResolvedTheme(theme: Theme): 'light' | 'dark' {
    if (theme === 'system') {
        if (typeof window !== 'undefined') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return 'light';
    }
    return theme;
}

function getInitialTheme(): Theme {
    if (typeof window === 'undefined') return 'system';
    const saved = localStorage.getItem('theme') as Theme | null;
    return (saved && ['light', 'dark', 'system'].includes(saved)) ? saved : 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    // Start with the server-rendered value ('system') so the first client render
    // matches the SSR HTML. Initializing from localStorage here instead would make
    // any theme-derived UI (e.g. the /options theme toggle, which highlights the
    // active option) hydrate-mismatch (React #418). The persisted choice is loaded
    // from localStorage right after mount, below.
    const [theme, setThemeState] = useState<Theme>('system');

    // Always start with 'light' to avoid hydration mismatch
    // Will be updated to actual value after mount
    const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
    const [mounted, setMounted] = useState(false);

    // Load the persisted theme once, after mount (post-hydration).
    useEffect(() => {
        const persisted = getInitialTheme();
        if (persisted !== 'system') setThemeState(persisted);
    }, []);

    // Update resolved theme after component mounts (client-side only)
    useEffect(() => {
        setMounted(true);
        setResolvedTheme(getResolvedTheme(theme));
    }, [theme]);

    // Apply the resolved theme, including an OS change while on "system".
    useEffect(() => {
        if (!mounted) return;
        applyThemeClass(resolvedTheme);
    }, [resolvedTheme, mounted]);

    // Apply theme when it changes
    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
        const resolved = getResolvedTheme(newTheme);
        setResolvedTheme(resolved);

        // Save to localStorage
        if (typeof window !== 'undefined') {
            localStorage.setItem('theme', newTheme);
        }

        // Apply theme immediately
        applyThemeClass(resolved);
    };

    // Listen for system theme changes
    useEffect(() => {
        if (!mounted || theme !== 'system') return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: MediaQueryListEvent) => {
            setResolvedTheme(e.matches ? 'dark' : 'light');
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [theme, mounted]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within ThemeProvider');
    }
    return context;
}
