'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DATA_MODE, getDataClient } from '@/lib/data';
import { CalendarDays, Clock, Languages, Network, Pencil, Share2, Trash2 } from '@/lib/icons';
import { Banner, MobileListHeader, MobileRow, PageShell, RadioRow, SegmentedControl, SwitchRow, cx } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import BackupPanel from '@/app/components/backup/BackupPanel';
import ShareTreeButton from '@/app/components/ShareTreeButton';
import EraseAllSummary from '@/app/components/options/EraseAllSummary';
import { useMyTrees } from '@/app/hooks/useMyTrees';
import { useTreeDisplayName } from '@/app/hooks/useTreeDisplayName';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { useTree } from '@/app/contexts/TreeContext';
import { useDesktopMode } from '@/app/hooks/useDesktopMode';
import type { Tree } from '@/lib/db/schema';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

type Theme = 'light' | 'dark' | 'system';
type Language = 'en' | 'fr' | 'ru';
interface ZoneGroup { key: string; label: string; zones: { value: string; label: string }[] }

/**
 * Options on a phone (#1122). No settings sidebar: each section is a full-width group on
 * the card colour with an eyebrow above and a hint below (not a card: no radius or
 * shadow). On/off settings are switch rows; a setting with a value is a row showing it
 * that opens a small sheet. Trees open a sheet with Rename, sharing and Delete. Erase all
 * data is a red row behind a type-to-confirm card. No Accessibility group: its one
 * setting, status symbols, marks † and ? on deceased and unknown people, and no phone
 * screen shows those marks (only the living dot), so it did nothing here.
 */
export function MobileOptions(p: {
    theme: Theme; onTheme: (v: Theme) => void;
    language: Language; onLanguage: (v: Language) => void;
    slashFormat: 'MDY' | 'DMY'; onSlashFormat: (v: 'MDY' | 'DMY') => void;
    timezone: string; timezoneLabel: string; detectedTimezone: string; onTimezone: (v: string) => void; zoneGroups: ZoneGroup[];
    colorblind: boolean; onColorblind: (v: boolean) => void;
    citePins: boolean; onCitePins: (v: boolean) => void;
    geocoding: boolean; onGeocoding: (v: boolean) => void;
    erasing: boolean; eraseResult: { success: boolean; message: string } | null; onErase: () => Promise<void>;
}) {
    const t = useTranslations('options');
    const tm = useTranslations('mobileOptions');
    const ta = useTranslations('about');
    const [sheet, setSheet] = useState<'language' | 'dates' | 'zone' | 'erase' | null>(null);
    const [zoneQuery, setZoneQuery] = useState('');
    const languages: { value: Language; label: string }[] = [{ value: 'en', label: 'English' }, { value: 'fr', label: 'Français' }, { value: 'ru', label: 'Русский' }];
    const q = zoneQuery.trim().toLowerCase();

    return (
        <PageShell topBar={<MobileListHeader title={t('title')} />} contentClassName="max-md:p-0!">
            <Group title={t('appearance_title')} hint={t('theme_system_note')} first>
                <div className="px-4 py-3">
                    <div className="text-base font-semibold text-text mb-2">{t('color_theme')}</div>
                    <SegmentedControl aria-label={t('color_theme')} fullWidth value={p.theme} onChange={(v) => p.onTheme(v as Theme)}
                        options={[{ v: 'light', l: t('theme_light') }, { v: 'dark', l: t('theme_dark') }, { v: 'system', l: t('theme_system') }]} />
                </div>
            </Group>

            <Group title={tm('language_and_dates')} hint={t('timezone_note')}>
                <MobileRow icon={<Languages aria-hidden="true" />} label={t('language_label')} value={languages.find((l) => l.value === p.language)?.label}
                    end="chevron" onClick={() => setSheet('language')} />
                <MobileRow divided icon={<CalendarDays aria-hidden="true" />} label={t('date_format_label')}
                    value={p.slashFormat === 'MDY' ? tm('mdy_short') : tm('dmy_short')} end="chevron" onClick={() => setSheet('dates')} />
                <MobileRow divided icon={<Clock aria-hidden="true" />} label={t('timezone_label')} value={p.timezoneLabel}
                    end="chevron" onClick={() => { setZoneQuery(''); setSheet('zone'); }} />
            </Group>

            <Group title={t('tree_title')}>
                <SwitchRow label={t('colorblind_label')} description={t('colorblind_desc')} checked={p.colorblind} onChange={p.onColorblind} />
            </Group>

            <TreesGroup />

            <Group title={t('experimental_title')} hint={t('experimental_desc')}>
                <SwitchRow label={t('cite_pins_tab')} description={t('cite_pins_tab_desc')} checked={p.citePins} onChange={p.onCitePins} />
                <SwitchRow divided label={t('geocoding_label')} description={t('geocoding_help')} checked={p.geocoding} onChange={p.onGeocoding} />
            </Group>

            {DATA_MODE === 'local' && (
                <Group title={t('local_data_title')} hint={t('local_data_desc')}>
                    <div className="px-4 py-4"><BackupPanel /></div>
                </Group>
            )}

            <Group title={t('danger_zone_title')}>
                <MobileRow tone="danger" icon={<Trash2 aria-hidden="true" />} label={t('erase_title')} sub={t('erase_desc')} onClick={() => setSheet('erase')} />
            </Group>
            {p.eraseResult && (
                <div className="px-4 pt-3">
                    <Banner tone={p.eraseResult.success ? 'success' : 'error'}>{p.eraseResult.message}</Banner>
                </div>
            )}
            <p className="m-0 px-4 pt-[22px] pb-[30px] text-center text-meta text-text-muted">
                {APP_VERSION ? tm('version', { version: APP_VERSION }) : tm('app_name')}
                {' · '}
                {/* The version line links to About too (#1256). */}
                <Link href="/about" className="relative text-link font-medium rounded focus-ring before:absolute before:-inset-3 before:content-['']">{ta('options_link')}</Link>
            </p>

            <Sheet open={sheet === 'language'} onClose={() => setSheet(null)} title={t('language_label')}>
                <div role="radiogroup" aria-label={t('language_label')} className="-mx-4 -mt-3">
                    {languages.map((l, i) => (
                        <RadioRow key={l.value} checked={p.language === l.value} label={l.label} divided={i > 0} onSelect={() => { p.onLanguage(l.value); setSheet(null); }} />
                    ))}
                </div>
            </Sheet>
            <Sheet open={sheet === 'dates'} onClose={() => setSheet(null)} title={t('date_format_label')}>
                <div role="radiogroup" aria-label={t('date_format_label')} className="-mx-4 -mt-3">
                    <RadioRow checked={p.slashFormat === 'MDY'} label={tm('mdy_short')} hint={t('date_mdy')} divided={false} onSelect={() => { p.onSlashFormat('MDY'); setSheet(null); }} />
                    <RadioRow checked={p.slashFormat === 'DMY'} label={tm('dmy_short')} hint={t('date_dmy')} divided onSelect={() => { p.onSlashFormat('DMY'); setSheet(null); }} />
                </div>
                <p className="m-0 pt-3 text-meta text-text-muted">{t('date_note')}</p>
            </Sheet>
            <Sheet open={sheet === 'zone'} onClose={() => setSheet(null)} title={t('timezone_label')} size="full">
                <div className="-mx-4 -mt-3">
                    <div className="px-4 pt-3 pb-1">
                        <input type="search" value={zoneQuery} onChange={(e) => setZoneQuery(e.target.value)} placeholder={tm('find_zone')} aria-label={tm('find_zone')}
                            autoComplete="off" className="w-full h-11 rounded-full border border-border bg-surface px-4 text-md text-text placeholder:text-text-muted input-nozoom focus-ring" />
                    </div>
                    <p className="m-0 px-4 pt-1 pb-1.5 text-meta text-text-muted">
                        {t('timezone_detected', { tz: p.detectedTimezone })}{' '}
                        {p.timezone !== p.detectedTimezone && (
                            <button type="button" onClick={() => { p.onTimezone(p.detectedTimezone); setSheet(null); }}
                                className="relative font-semibold text-link cursor-pointer rounded focus-ring before:absolute before:-inset-y-3 before:inset-x-0 before:content-['']">
                                {t('timezone_reset')}
                            </button>
                        )}
                    </p>
                    <div role="radiogroup" aria-label={t('timezone_label')}>
                        {p.zoneGroups.map((g) => {
                            const zones = g.zones.filter((z) => !q || z.label.toLowerCase().includes(q) || z.value.toLowerCase().includes(q));
                            if (zones.length === 0) return null;
                            return (
                                <div key={g.key}>
                                    <div className="eyebrow px-4 pt-4 pb-1.5">{g.label}</div>
                                    {zones.map((z, i) => (
                                        <RadioRow key={z.value} checked={p.timezone === z.value} label={z.label} divided={i > 0} onSelect={() => { p.onTimezone(z.value); setSheet(null); }} />
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </Sheet>
            <TypeToConfirmSheet open={sheet === 'erase'} onClose={() => setSheet(null)} title={t('erase_confirm_title')}
                body={<EraseAllSummary open={sheet === 'erase'} />} phrase={t('erase_phrase')} label={tm('type_phrase', { phrase: t('erase_phrase') })}
                confirmLabel={p.erasing ? t('erasing') : t('erase_everything')} keepLabel={t('erase_cancel')} busy={p.erasing}
                onConfirm={async () => { await p.onErase(); setSheet(null); }} />
        </PageShell>
    );
}

/** A full-width settings group on the card colour: eyebrow above, hint below. */
function Group({ title, hint, first = false, children }: { title: React.ReactNode; hint?: string; first?: boolean; children: React.ReactNode }) {
    return (
        <section>
            <h2 className={cx('eyebrow m-0 flex justify-between px-4 pb-2', first ? 'pt-[18px]' : 'pt-[26px]')}>{title}</h2>
            <div className="bg-card border-y border-border">{children}</div>
            {hint && <p className="m-0 px-4 pt-2 text-meta leading-snug text-text-muted">{hint}</p>}
        </section>
    );
}

/** Your trees as rows; each opens a sheet with Rename, Manage sharing and Delete. */
function TreesGroup() {
    const t = useTranslations('options');
    const tm = useTranslations('mobileOptions');
    const tc = useTranslations('common');
    const treeName = useTreeDisplayName();
    const { timestamp } = useTimestamp();
    const { trees, refresh } = useMyTrees();
    const { activeTreeId, switchToDefaultTree } = useTree();
    const isDesktop = useDesktopMode();
    const canShare = DATA_MODE !== 'local' && !isDesktop;
    const [openId, setOpenId] = useState<number | null>(null);
    const [step, setStep] = useState<'menu' | 'rename' | 'delete' | 'share' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cleanup, setCleanup] = useState(0);
    const open = trees.find((tr) => tr.Id === openId) ?? null;
    const onlyTree = trees.length <= 1;
    const close = () => { setStep(null); setError(null); };

    return (
        <>
            <Group title={<>{t('trees_title')}<span className="font-mono normal-case tracking-normal font-normal">{trees.length}</span></>}>
                {trees.map((tree, i) => (
                    <MobileRow key={tree.Id} divided={i > 0} icon={<Network aria-hidden="true" />}
                        label={<span className="serif text-md">{treeName(tree.Name)}</span>}
                        sub={t('trees_created', { date: timestamp(tree.CreatedAt, 'date') })}
                        end="chevron" onClick={() => { setOpenId(tree.Id); setStep('menu'); setError(null); }} />
                ))}
            </Group>
            {cleanup > 0 && <p role="status" className="m-0 mx-4 mt-3 rounded-lg p-3 text-sm bg-warning-bg text-warning-text">{t('trees_cleanup_warning', { count: cleanup })}</p>}

            <Sheet open={step === 'menu' && open != null} onClose={close} title={open ? treeName(open.Name) : ''}>
                {open && (
                    <div className="-mx-4 -mt-3">
                        <div className="flex justify-between gap-3 px-4 py-[11px] text-base">
                            <span className="text-text-muted">{tm('created')}</span><span>{timestamp(open.CreatedAt, 'date')}</span>
                        </div>
                        <div className="mt-2 border-t border-border">
                            <MobileRow icon={<Pencil aria-hidden="true" />} label={t('trees_rename')} end="chevron" onClick={() => setStep('rename')} />
                            {canShare && open.Id === activeTreeId && (
                                <MobileRow divided icon={<Share2 aria-hidden="true" />} label={tm('manage_sharing')} end="chevron" onClick={() => setStep('share')} />
                            )}
                            <MobileRow divided tone="danger" icon={<Trash2 aria-hidden="true" />} label={t('trees_delete')}
                                sub={onlyTree ? t('trees_last_tree_hint') : tm('delete_tree_hint')} disabled={onlyTree} onClick={() => setStep('delete')} />
                        </div>
                    </div>
                )}
            </Sheet>
            {open && <RenameSheet key={`r${open.Id}-${step === 'rename'}`} open={step === 'rename'} tree={open} onClose={() => setStep('menu')}
                onSave={async (name) => {
                    const client = await getDataClient();
                    await client.trees.rename(open.Id, name);
                    await refresh();
                    close();
                }} />}
            {open && <TypeToConfirmSheet open={step === 'delete'} onClose={() => setStep('menu')} title={t('trees_delete_confirm_title')}
                body={<>{t('trees_delete_confirm_body', { name: treeName(open.Name) })} {t('trees_delete_export_hint')}</>}
                phrase={treeName(open.Name)} label={t('trees_delete_type_name')} confirmLabel={t('trees_delete')} keepLabel={tc('cancel')} error={error}
                onConfirm={async () => {
                    setError(null);
                    try {
                        const client = await getDataClient();
                        const { cleanupWarningCount } = await client.trees.remove(open.Id);
                        setCleanup(cleanupWarningCount);
                        await refresh();
                        if (activeTreeId === open.Id) switchToDefaultTree();
                        close();
                    } catch (e) {
                        setError(e instanceof Error ? e.message : tc('error'));
                    }
                }} />}
            {step === 'share' && <ShareTreeButton forceOpen elevated onClose={close} />}
        </>
    );
}

function RenameSheet({ open, tree, onClose, onSave }: { open: boolean; tree: Tree; onClose: () => void; onSave: (name: string) => Promise<void> }) {
    const t = useTranslations('options');
    const tm = useTranslations('mobileOptions');
    const tc = useTranslations('common');
    const treeName = useTreeDisplayName();
    const id = useId();
    const start = treeName(tree.Name);
    const [value, setValue] = useState(start);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const name = value.trim();
    const dirty = name !== '' && name !== start && name !== tree.Name;
    return (
        <Sheet open={open} onClose={onClose} title={t('trees_rename')} size="full" dirty={dirty} saveDisabled={!dirty || saving}
            onSave={async () => {
                setSaving(true);
                setError(null);
                try { await onSave(name); } catch (e) { setError(e instanceof Error ? e.message : tc('error')); setSaving(false); }
            }}>
            <div className="grid gap-1.5 pt-1">
                <label htmlFor={id} className="text-meta font-semibold text-text-secondary">{tm('tree_name')}</label>
                <input id={id} value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} autoComplete="off"
                    className="w-full h-[46px] rounded-[10px] border border-border bg-surface px-3 text-md text-text input-nozoom focus-ring" />
                {error && <p role="alert" className="m-0 text-meta text-error">{error}</p>}
            </div>
        </Sheet>
    );
}

/** The heavy delete: a card that names what goes, a field to type the phrase, the red pill and the way back. */
function TypeToConfirmSheet({ open, onClose, title, body, phrase, label, confirmLabel, keepLabel, busy = false, error, onConfirm }: {
    open: boolean; onClose: () => void; title: string; body: React.ReactNode; phrase: string; label: string;
    confirmLabel: string; keepLabel: string; busy?: boolean; error?: string | null; onConfirm: () => Promise<void>;
}) {
    const id = useId();
    const [typed, setTyped] = useState('');
    const [running, setRunning] = useState(false);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setTyped('');
    }
    const working = busy || running;
    return (
        <Sheet open={open} onClose={onClose} title={title}>
            <div className="text-base leading-normal text-text-secondary">{body}</div>
            <div className="grid gap-1.5 pt-4">
                <label htmlFor={id} className="text-meta font-semibold text-text-secondary">{label}</label>
                <input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" disabled={working}
                    className="w-full h-[46px] rounded-[10px] border border-border bg-surface px-3 text-md text-text input-nozoom focus-ring" />
            </div>
            {error && <p role="alert" className="m-0 pt-2 text-meta text-error">{error}</p>}
            <button type="button" disabled={typed !== phrase || working}
                onClick={async () => { setRunning(true); try { await onConfirm(); } finally { setRunning(false); } }}
                className="mt-4 w-full h-12 rounded-full bg-error text-white font-semibold text-md cursor-pointer focus-ring disabled:opacity-40 disabled:cursor-default">
                {confirmLabel}
            </button>
            <button type="button" onClick={onClose} disabled={working}
                className="w-full h-11 mt-1 text-md font-semibold text-text cursor-pointer rounded-full focus-ring">
                {keepLabel}
            </button>
        </Sheet>
    );
}
