'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '@/app/components/ThemeProvider';
import { useLanguage, useTimezone } from '@/app/components/LanguageProvider';
import { useTranslations } from 'next-intl';
import { timeZoneName, timeZoneOffset } from '@/lib/utils/timezones';
import { DATA_MODE, getDataClient } from '@/lib/data';
import { useTree } from '@/app/contexts/TreeContext';
import { useMyTrees } from '@/app/hooks/useMyTrees';
import { Banner, Button, Card, CoverBand, PageShell, SegmentedControl, SelectField } from '@/app/components/ui';
import { Accessibility, AlertTriangle, CalendarDays, CheckCircle2, FlaskConical, HardDrive, Languages, Monitor, Moon, Network, Palette, Sun, Trash2, TreeDeciduous, type LucideIcon } from '@/lib/icons';
import { readStatusSymbols, writeStatusSymbols } from '@/lib/utils/status-symbols';
import LocalDataSection from '@/app/components/LocalDataSection';
import TreesSection from '@/app/components/options/TreesSection';
import EraseAllSummary from '@/app/components/options/EraseAllSummary';
import { isGeocodingEnabled, setGeocodingEnabled } from '@/lib/geocode/prefs';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { MobileOptions } from './MobileOptions';
import Link from 'next/link';
import { useDesktopMode } from '@/app/hooks/useDesktopMode';
import { aboutInfo } from '@/lib/about';

/** The settings nav, in page order. Local data only exists in the local build. */
const NAV: { href: string; key: string; Icon: LucideIcon; danger?: boolean }[] = [
    { href: '#appearance', key: 'nav_appearance', Icon: Palette },
    { href: '#accessibility', key: 'nav_accessibility', Icon: Accessibility },
    { href: '#language', key: 'nav_language', Icon: Languages },
    { href: '#date-preferences', key: 'nav_date_format', Icon: CalendarDays },
    { href: '#tree-preferences', key: 'nav_tree', Icon: Network },
    { href: '#trees', key: 'nav_trees', Icon: TreeDeciduous },
    { href: '#experimental', key: 'nav_experimental', Icon: FlaskConical },
    ...(DATA_MODE === 'local' ? [{ href: '#local-data', key: 'local_data_title', Icon: HardDrive }] : []),
    { href: '#danger-zone', key: 'nav_danger_zone', Icon: AlertTriangle, danger: true },
];

/** The picker's zones. Labels are built at render from `Intl` (#704); a city is
 *  named only where several zones share one generic name. */
const TIMEZONE_GROUPS: { groupKey: string; zones: { value: string; cityKey?: string }[] }[] = [
    {
        groupKey: 'tz_group_americas',
        zones: [
            { value: 'America/New_York' },
            { value: 'America/Chicago' },
            { value: 'America/Denver' },
            { value: 'America/Los_Angeles' },
            { value: 'America/Anchorage' },
            { value: 'Pacific/Honolulu' },
            { value: 'America/Toronto', cityKey: 'tz_city_toronto' },
            { value: 'America/Vancouver', cityKey: 'tz_city_vancouver' },
            { value: 'America/Mexico_City', cityKey: 'tz_city_mexico_city' },
            { value: 'America/Sao_Paulo' },
            { value: 'America/Argentina/Buenos_Aires' },
            { value: 'America/Bogota' },
        ],
    },
    {
        groupKey: 'tz_group_europe',
        zones: [
            { value: 'Europe/London' },
            { value: 'Europe/Paris', cityKey: 'tz_city_paris' },
            { value: 'Europe/Berlin', cityKey: 'tz_city_berlin' },
            { value: 'Europe/Madrid', cityKey: 'tz_city_madrid' },
            { value: 'Europe/Rome', cityKey: 'tz_city_rome' },
            { value: 'Europe/Amsterdam', cityKey: 'tz_city_amsterdam' },
            { value: 'Europe/Zurich', cityKey: 'tz_city_zurich' },
            { value: 'Europe/Vienna', cityKey: 'tz_city_vienna' },
            { value: 'Europe/Warsaw', cityKey: 'tz_city_warsaw' },
            { value: 'Europe/Stockholm', cityKey: 'tz_city_stockholm' },
            { value: 'Europe/Helsinki', cityKey: 'tz_city_helsinki' },
            { value: 'Europe/Athens', cityKey: 'tz_city_athens' },
            { value: 'Europe/Moscow' },
            { value: 'Europe/Istanbul' },
        ],
    },
    {
        groupKey: 'tz_group_asia_pacific',
        zones: [
            { value: 'Asia/Dubai' },
            { value: 'Asia/Tehran' },
            { value: 'Asia/Jerusalem' },
            { value: 'Asia/Kolkata' },
            { value: 'Asia/Bangkok' },
            { value: 'Asia/Singapore' },
            { value: 'Asia/Shanghai' },
            { value: 'Asia/Hong_Kong' },
            { value: 'Asia/Seoul' },
            { value: 'Asia/Tokyo' },
            { value: 'Australia/Sydney' },
            { value: 'Australia/Perth' },
            { value: 'Pacific/Auckland' },
        ],
    },
    {
        groupKey: 'tz_group_africa',
        zones: [
            { value: 'Africa/Cairo', cityKey: 'tz_city_cairo' },
            { value: 'Africa/Lagos' },
            { value: 'Africa/Nairobi' },
            { value: 'Africa/Johannesburg' },
        ],
    },
    {
        groupKey: 'tz_group_utc',
        zones: [
            { value: 'UTC' },
        ],
    },
];

export default function OptionsPage() {
    const { theme, setTheme } = useTheme();
    const { language, setLanguage } = useLanguage();
    const { timezone, setTimezone } = useTimezone();
    const { switchToDefaultTree } = useTree();
    // enabled:false — TreesSection already triggers the initial fetch; this
    // handle exists so handleErase can refresh the (now all-deleted) list.
    const { refresh: refreshMyTrees } = useMyTrees(false);
    const t = useTranslations('options');
    const ta = useTranslations('about');
    const isDesktopMode = useDesktopMode();
    const { version } = aboutInfo();
    // Builds without an account menu end Options with the About row instead (#1256).
    const showAboutRow = DATA_MODE === 'local' || isDesktopMode;
    const [slashFormat, setSlashFormat] = useState<'MDY' | 'DMY'>('MDY');
    const [showEraseConfirm, setShowEraseConfirm] = useState(false);
    const [erasing, setErasing] = useState(false);
    const [eraseResult, setEraseResult] = useState<{ success: boolean; message: string } | null>(null);
    const [colorblindMode, setColorblindMode] = useState(false);
    const [statusSymbols, setStatusSymbols] = useState(false);
    const [detectedTimezone, setDetectedTimezone] = useState('UTC');
    const [citePinsInTabOrder, setCitePinsInTabOrder] = useState(false);
    const [geocoding, setGeocoding] = useState(true);
    const isMobile = useIsMobile();

    useDocumentTitle(t('title'));

    // Load preferences from localStorage on mount
    useEffect(() => {
        localStorage.removeItem('accentColor');
        const saved = localStorage.getItem('dateSlashFormat');
        if (saved === 'DMY') setSlashFormat('DMY');
        setColorblindMode(localStorage.getItem('treeColorblindMode') === 'true');
        setDetectedTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
        // The Citation linter toggle was removed (#494): nothing read it, and cite
        // pins always show. Drop the orphaned preference.
        localStorage.removeItem('citationLinter');
        setCitePinsInTabOrder(localStorage.getItem('citePinsInTabOrder') === 'true');
        setStatusSymbols(readStatusSymbols());
        setGeocoding(isGeocodingEnabled());
    }, []);

    function handleStatusSymbolsChange(value: boolean) {
        setStatusSymbols(value);
        writeStatusSymbols(value);
    }

    function handleCitePinsInTabOrderChange(value: boolean) {
        setCitePinsInTabOrder(value);
        localStorage.setItem('citePinsInTabOrder', String(value));
    }

    function handleSlashFormatChange(value: 'MDY' | 'DMY') {
        setSlashFormat(value);
        localStorage.setItem('dateSlashFormat', value);
    }

    function setColorblind(value: boolean) {
        setColorblindMode(value);
        localStorage.setItem('treeColorblindMode', String(value));
    }

    function handleTimezoneReset() {
        localStorage.removeItem('timezone');
        setTimezone(detectedTimezone);
    }

    const closeEraseModal = useCallback(() => {
        setShowEraseConfirm(false);
    }, []);

    async function handleErase() {
        setErasing(true);
        setEraseResult(null);
        try {
            const client = await getDataClient();
            const data = await client.gedcom.reset();
            // Reset deletes every Trees row (a fresh default is lazily
            // recreated server-side). A persisted non-default selection now
            // points at a deleted tree — clear it or every subsequent read
            // 403s until a full reload; also refresh the switcher's list.
            switchToDefaultTree();
            void refreshMyTrees();
            setEraseResult({ success: true, message: data.message });
            setShowEraseConfirm(false);
        } catch (e) {
            setEraseResult({ success: false, message: e instanceof Error ? e.message : t('failed_erase') });
        } finally {
            setErasing(false);
        }
    }

    const zoneGroups = TIMEZONE_GROUPS.map(({ groupKey, zones }) => ({
        key: groupKey,
        label: t(groupKey),
        zones: zones.map(({ value, cityKey }) => {
            const name = value === 'UTC' ? t('tz_utc') : timeZoneName(value, language);
            const city = cityKey ? ` — ${t(cityKey)}` : '';
            return { value, label: `${name}${city} (${timeZoneOffset(value)})` };
        }),
    }));

    if (isMobile) {
        const zoneLabel = zoneGroups.flatMap((g) => g.zones).find((z) => z.value === timezone)?.label ?? timezone;
        return (
            <MobileOptions
                theme={theme} onTheme={setTheme}
                language={language} onLanguage={setLanguage}
                slashFormat={slashFormat} onSlashFormat={handleSlashFormatChange}
                timezone={timezone} timezoneLabel={zoneLabel} detectedTimezone={detectedTimezone} zoneGroups={zoneGroups}
                onTimezone={(v) => { if (v === detectedTimezone) handleTimezoneReset(); else setTimezone(v); }}
                colorblind={colorblindMode} onColorblind={setColorblind}
                citePins={citePinsInTabOrder} onCitePins={handleCitePinsInTabOrderChange}
                geocoding={geocoding} onGeocoding={(v) => { setGeocoding(v); setGeocodingEnabled(v); }}
                erasing={erasing} eraseResult={eraseResult} onErase={handleErase}
            />
        );
    }

    return (
        <PageShell>
                {/* Desktop (#59): the short navy band, then the settings in white panels. */}
                <CoverBand variant="short" title={t('title')} meta={t('subtitle')} className="mb-6" />
                <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-8 items-start">
                    {/* Sidebar nav */}
                    <Card role="navigation" pad={false} className="p-6 lg:sticky lg:top-4">
                        <p className="eyebrow mb-3">{t('sidebar_settings')}</p>
                        <ul className="space-y-1">
                            {NAV.map(({ href, key, Icon, danger }) => (
                                <li key={href}>
                                    <a
                                        href={href}
                                        className={danger
                                            ? 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-error hover:bg-error/10 transition-colors focus-ring'
                                            : 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-text hover:bg-hover-surface transition-colors focus-ring'}
                                    >
                                        <Icon className={danger ? 'w-4 h-4 shrink-0' : 'w-4 h-4 shrink-0 text-text-muted'} aria-hidden="true" />
                                        {t(key)}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </Card>

                    {/* Settings content */}
                    <div className="space-y-6">
                        <Card id="appearance" pad={false} className="p-6">
                            <h2 className="section text-text mb-4">{t('appearance_title')}</h2>
                            <div>
                                <div className="block text-sm font-medium text-text mb-2">{t('color_theme')}</div>
                                <SegmentedControl
                                    aria-label={t('color_theme')}
                                    value={theme}
                                    onChange={(v) => setTheme(v as typeof theme)}
                                    options={[
                                        { v: 'light', l: t('theme_light'), icon: <Sun className="w-4 h-4" /> },
                                        { v: 'dark', l: t('theme_dark'), icon: <Moon className="w-4 h-4" /> },
                                        { v: 'system', l: t('theme_system'), icon: <Monitor className="w-4 h-4" /> },
                                    ]}
                                />
                                <p className="mt-2 text-xs text-text-muted">
                                    {t('theme_system_note')}
                                </p>
                            </div>
                        </Card>

                        <Card id="accessibility" pad={false} className="p-6">
                            <h2 className="section text-text mb-4">{t('accessibility_title')}</h2>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={statusSymbols}
                                    onChange={(e) => handleStatusSymbolsChange(e.target.checked)}
                                    className="rounded mt-0.5"
                                />
                                <div>
                                    <span className="text-sm font-medium text-text">{t('status_symbols_label')}</span>
                                    <p className="text-xs text-text-muted mt-0.5">{t('status_symbols_desc')}</p>
                                </div>
                            </label>
                        </Card>

                        <Card id="language" pad={false} className="p-6">
                            <h2 className="section text-text mb-4">{t('language_title')}</h2>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                <label htmlFor="language-select" className="text-sm font-medium text-text-secondary shrink-0">
                                    {t('language_label')}
                                </label>
                                <SelectField<'en' | 'fr' | 'ru'>
                                    id="language-select"
                                    value={language}
                                    onChange={setLanguage}
                                    size="sm"
                                    width="w-full sm:w-auto"
                                    options={[
                                        { value: 'en', label: 'English' },
                                        { value: 'fr', label: 'Français' },
                                        { value: 'ru', label: 'Русский' },
                                    ]}
                                />
                            </div>
                            <p className="mt-2 text-xs text-text-muted">
                                {t('language_note')}
                            </p>
                        </Card>

                        <Card id="date-preferences" pad={false} className="p-6">
                            <h2 className="section text-text mb-4">{t('date_title')}</h2>

                            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                <label htmlFor="slash-format" className="text-sm font-medium text-text-secondary shrink-0">
                                    {t('date_format_label')}
                                </label>
                                <SelectField<'MDY' | 'DMY'>
                                    id="slash-format"
                                    value={slashFormat}
                                    onChange={handleSlashFormatChange}
                                    size="sm"
                                    width="w-full sm:w-auto"
                                    options={[
                                        { value: 'MDY', label: t('date_mdy') },
                                        { value: 'DMY', label: t('date_dmy') },
                                    ]}
                                />
                            </div>
                            <p className="mt-2 text-xs text-text-muted">
                                {t('date_note')}
                            </p>

                            <div className="border-t border-border pt-4 mt-4">
                                <label htmlFor="timezone-select" className="block text-sm font-medium text-text-secondary mb-1">
                                    {t('timezone_label')}
                                </label>
                                <p className="text-xs text-text-muted mb-2">
                                    {t('timezone_detected', { tz: detectedTimezone })}
                                </p>
                                <div className="flex flex-wrap items-center gap-2">
                                    <SelectField
                                        id="timezone-select"
                                        value={timezone}
                                        onChange={setTimezone}
                                        size="sm"
                                        width="w-full sm:w-auto"
                                        // The offset is computed from "now", so a prerendered label can
                                        // differ after a DST change since the build (SelectField
                                        // suppresses that hydration warning on its value).
                                        groups={zoneGroups.map(({ key, label, zones }) => ({ key, label, options: zones }))}
                                    />
                                    <Button variant="outline" size="sm" className="text-sm" onClick={handleTimezoneReset}>
                                        {t('timezone_reset')}
                                    </Button>
                                </div>
                                <p className="mt-2 text-xs text-text-muted">{t('timezone_note')}</p>
                            </div>
                        </Card>

                        <Card id="tree-preferences" pad={false} className="p-6">
                            <h2 className="section text-text mb-4">{t('tree_title')}</h2>

                            <div className="space-y-4">
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={colorblindMode}
                                        onChange={(e) => setColorblind(e.target.checked)}
                                        className="rounded mt-0.5"
                                    />
                                    <div>
                                        <span className="text-sm font-medium text-text">{t('colorblind_label')}</span>
                                        <p className="text-xs text-text-muted mt-0.5">
                                            {t('colorblind_desc')}
                                        </p>
                                    </div>
                                </label>
                            </div>
                        </Card>

                        <TreesSection />

                        <Card id="experimental" pad={false} className="p-6">
                            <h2 className="section text-text mb-1">{t('experimental_title')}</h2>
                            <p className="text-xs text-text-muted mb-4">{t('experimental_desc')}</p>

                            <div className="space-y-4">
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={citePinsInTabOrder}
                                        onChange={(e) => handleCitePinsInTabOrderChange(e.target.checked)}
                                        className="rounded mt-0.5"
                                    />
                                    <div>
                                        <span className="text-sm font-medium text-text">{t('cite_pins_tab')}</span>
                                        <p className="text-xs text-text-muted mt-0.5">
                                            {t('cite_pins_tab_desc')}
                                        </p>
                                    </div>
                                </label>

                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={geocoding}
                                        onChange={(e) => { setGeocoding(e.target.checked); setGeocodingEnabled(e.target.checked); }}
                                        className="rounded mt-0.5"
                                    />
                                    <div>
                                        <span className="text-sm font-medium text-text">{t('geocoding_label')}</span>
                                        <p className="text-xs text-text-muted mt-0.5">
                                            {t('geocoding_help')}
                                        </p>
                                    </div>
                                </label>
                            </div>
                        </Card>

                        <LocalDataSection />

                        <Card id="danger-zone" pad={false} className="p-6 border-2 border-error/30">
                            <h2 className="section text-error mb-1">{t('danger_zone_title')}</h2>
                            <p className="text-xs text-text-muted mb-4">{t('danger_zone_desc')}</p>

                            <div className="border border-error/20 rounded-lg p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-sm font-medium text-text">{t('erase_title')}</p>
                                        <p className="text-xs text-text-muted mt-0.5">{t('erase_desc')}</p>
                                    </div>
                                    <Button
                                        variant="danger"
                                        className="shrink-0"
                                        icon={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                                        onClick={() => setShowEraseConfirm(true)}
                                    >
                                        {t('erase_button')}
                                    </Button>
                                </div>
                                {eraseResult && (
                                    <Banner
                                        tone={eraseResult.success ? 'success' : 'error'}
                                        icon={eraseResult.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                                        className="mt-3"
                                    >
                                        {eraseResult.message}
                                    </Banner>
                                )}
                            </div>
                        </Card>

                        {showAboutRow && (
                            <Link href="/about" className="flex items-baseline justify-between gap-3 border-t border-border px-1 pt-3 text-sm text-text-muted rounded-sm focus-ring">
                                <span className="text-link font-medium hover:underline underline-offset-2">{ta('menu_row')}</span>
                                {version && <span>{ta('menu_version', { version })}</span>}
                            </Link>
                        )}
                    </div>
                </div>

            <ConfirmDialog
                open={showEraseConfirm}
                variant="type-to-confirm"
                tone="danger"
                title={t('erase_confirm_title')}
                body={<EraseAllSummary open={showEraseConfirm} />}
                confirmPhrase={t('erase_phrase')}
                confirmLabel={erasing ? t('erasing') : t('erase_everything')}
                cancelLabel={t('erase_cancel')}
                busy={erasing}
                onConfirm={handleErase}
                onCancel={closeEraseModal}
            />
        </PageShell>
    );
}
