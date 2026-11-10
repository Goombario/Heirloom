'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { useSession } from 'next-auth/react';

import enMessages from '@/messages/en.json';
import frMessages from '@/messages/fr.json';
import ruMessages from '@/messages/ru.json';

export type Language = 'en' | 'fr' | 'ru';

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    timezone: string;
    setTimezone: (tz: string) => void;
}

const messages: Record<Language, typeof enMessages> = {
    en: enMessages,
    fr: frMessages,
    ru: ruMessages,
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function normalizeLocale(locale: string | undefined | null): Language | null {
    if (!locale) return null;
    const lang = locale.split('-')[0].toLowerCase();
    if (lang === 'fr') return 'fr';
    if (lang === 'ru') return 'ru';
    if (lang === 'en') return 'en';
    return null;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
    const [language, setLanguageState] = useState<Language>('en');
    const [timezone, setTimezoneState] = useState<string>('UTC'); // safe SSR default
    const [mounted, setMounted] = useState(false);
    const { data: session } = useSession();

    useEffect(() => {
        setMounted(true);

        // Priority: localStorage → Google locale → browser locale → 'en'
        const saved = localStorage.getItem('language') as Language | null;
        if (saved && (saved === 'en' || saved === 'fr' || saved === 'ru')) {
            setLanguageState(saved);
        } else {
            const googleLocale = normalizeLocale((session?.user as { locale?: string } | undefined)?.locale);
            if (googleLocale) {
                setLanguageState(googleLocale);
            } else {
                const browserLocale = normalizeLocale(navigator.language);
                if (browserLocale) setLanguageState(browserLocale);
            }
        }

        // Priority: localStorage override → browser auto-detection
        const savedTz = localStorage.getItem('timezone');
        setTimezoneState(savedTz || Intl.DateTimeFormat().resolvedOptions().timeZone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const setLanguage = (lang: Language) => {
        setLanguageState(lang);
        if (typeof window !== 'undefined') {
            localStorage.setItem('language', lang);
        }
    };

    const setTimezone = (tz: string) => {
        setTimezoneState(tz);
        localStorage.setItem('timezone', tz);
    };

    // Use safe defaults before mount to avoid hydration mismatch
    const activeLocale = mounted ? language : 'en';
    const activeTimezone = mounted ? timezone : 'UTC';

    // `<html lang>` follows the UI language: screen readers pronounce by it, and
    // list ordering (`lib/collation`) reads it outside React (#882).
    useEffect(() => {
        document.documentElement.lang = activeLocale;
    }, [activeLocale]);

    return (
        <LanguageContext.Provider value={{ language, setLanguage, timezone, setTimezone }}>
            <NextIntlClientProvider locale={activeLocale} messages={messages[activeLocale]} timeZone={activeTimezone}>
                {children}
            </NextIntlClientProvider>
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within LanguageProvider');
    }
    return context;
}

export function useTimezone() {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useTimezone must be used within LanguageProvider');
    }
    return { timezone: context.timezone, setTimezone: context.setTimezone };
}
