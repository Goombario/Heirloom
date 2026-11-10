'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import PersonPicker from '@/app/components/PersonPicker';
import { FamilySearch } from '@/app/components/FamilySearch';
import { CertaintySegments } from '@/app/components/citations/CertaintySegments';
import { Badge, Button, FilterChip, fieldClass } from '@/app/components/ui';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { getDataClient } from '@/lib/data';
import { formatDateForDisplay, formatLifespan, formatYearOrEmpty } from '@/lib/date-utils';
import { EVENT_TYPES, getEventDisplayType } from '@/lib/db/schema';
import { Quote, Users, X } from '@/lib/icons';
import type { CitedByRow } from '@/lib/db/queries/citations';
import type { Source } from '@/lib/data/types';
import { citeKey, citeOnPersonFrom, preselectedKeys, sourceYear, type CiteOnFact, type CiteOnPerson } from './citeOnFacts';

/**
 * "Cite on…" from the source view (#799, EV-7): cite one source on many facts
 * in one write. Add people one by one or a whole household (its partners and
 * children), tick the facts, and give one shared citation detail and certainty,
 * with an optional page or line per fact. Facts dated in the year the source's
 * title names are ticked for you; facts already citing this source are shown
 * but can't be ticked again.
 */
export function CiteOnPanel({ source, treeId, citedBy, titleId, isMobile, onCancel, onCited, onSavingChange }: {
    source: Source;
    treeId: number | null;
    citedBy: CitedByRow[];
    titleId: string;
    isMobile: boolean;
    onCancel: () => void;
    onCited: (count: number) => void;
    /** The write is in flight, so the modal's Escape leaves it alone (#846). */
    onSavingChange?: (saving: boolean) => void;
}) {
    const t = useTranslations('library');
    const tc = useTranslations('common');
    const tTypes = useTranslations('eventTypes');
    const { language } = useLanguage();
    const dateWords = useDateQualifierWords();
    const { redirectIfUnauthorized } = useErrorToast();
    const idBase = useId();

    const year = sourceYear(source.Title);
    const cited = useMemo(() => new Set(citedBy.map(row => citeKey(row.factTable, row.factId))), [citedBy]);

    const [people, setPeople] = useState<CiteOnPerson[]>([]);
    const [ticked, setTicked] = useState<Set<string>>(new Set());
    const [rowPages, setRowPages] = useState<Record<string, string>>({});
    const [page, setPage] = useState('');
    const [quay, setQuay] = useState('');
    const [dataText, setDataText] = useState('');
    const [householdOpen, setHouseholdOpen] = useState(source.Type === 'Census');
    const [adding, setAdding] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useUnsavedChangesGuard(people.length > 0 || page !== '' || quay !== '' || dataText !== '');

    // Opening puts focus in the household search when it shows (a census), else the
    // person picker, rather than leaving it on the page (#861). Not on a phone, where
    // focusing a field would raise the keyboard over the panel.
    const bodyRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (isMobile) return;
        const root = bodyRef.current;
        (root?.querySelector<HTMLElement>('[data-cite-on-household] input') ?? root?.querySelector<HTMLElement>('input'))?.focus();
        // Once, on open.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const typeLabel = (type: string) =>
        EVENT_TYPES[type] ? tTypes(type as Parameters<typeof tTypes>[0]) : getEventDisplayType(type);
    const personName = (p: CiteOnPerson) => p.name || tc('unknown');

    async function addPeople(ids: number[]) {
        const fresh = ids.filter((id, i) => ids.indexOf(id) === i && !people.some(p => p.id === id));
        if (fresh.length === 0) return;
        setAdding(true);
        setError(null);
        try {
            const client = await getDataClient();
            const loaded = (await Promise.all(fresh.map(id => client.people.get(id, treeId)))).map(citeOnPersonFrom);
            setPeople(prev => [...prev, ...loaded.filter(p => !prev.some(q => q.id === p.id))]);
            setTicked(prev => {
                const next = new Set(prev);
                for (const p of loaded) for (const key of preselectedKeys(p, year, cited)) next.add(key);
                return next;
            });
        } catch (err) {
            if (!redirectIfUnauthorized(err)) setError(t('cite_on_load_failed'));
        } finally {
            setAdding(false);
        }
    }

    async function addHousehold(familyId: number) {
        setAdding(true);
        try {
            const client = await getDataClient();
            const detail = await client.families.get(familyId, treeId);
            const ids = [detail.husband?.Id, detail.wife?.Id, ...(detail.children ?? []).map(c => c.Id)]
                .filter((id): id is number => typeof id === 'number');
            setHouseholdOpen(false);
            await addPeople(ids);
        } catch (err) {
            if (!redirectIfUnauthorized(err)) setError(t('cite_on_load_failed'));
        } finally {
            // addPeople returns early when everyone is already listed.
            setAdding(false);
        }
    }

    function removePerson(p: CiteOnPerson) {
        setPeople(prev => prev.filter(q => q.id !== p.id));
        setTicked(prev => {
            const next = new Set(prev);
            for (const f of p.facts) next.delete(f.key);
            return next;
        });
    }

    function toggle(key: string, on: boolean) {
        setTicked(prev => {
            const next = new Set(prev);
            if (on) next.add(key); else next.delete(key);
            return next;
        });
    }

    // "Tick every birth" and the like: one switch per fact type present, across everyone.
    const openFacts = people.flatMap(p => p.facts).filter(f => !cited.has(f.key));
    const types = [...new Set(openFacts.map(f => f.type))];
    function toggleType(type: string) {
        const keys = openFacts.filter(f => f.type === type).map(f => f.key);
        const allOn = keys.every(k => ticked.has(k));
        setTicked(prev => {
            const next = new Set(prev);
            for (const k of keys) if (allOn) next.delete(k); else next.add(k);
            return next;
        });
    }

    const count = openFacts.filter(f => ticked.has(f.key)).length;

    async function submit() {
        const facts = people.flatMap(p => p.facts).filter(f => ticked.has(f.key) && !cited.has(f.key));
        if (facts.length === 0) return;
        setSaving(true);
        onSavingChange?.(true);
        setError(null);
        try {
            const client = await getDataClient();
            await client.citations.createMany({
                SourceId: source.Id,
                Page: page || null,
                Quay: quay || null,
                DataText: dataText || null,
                facts: facts.map(f => ({ FactTable: f.factTable, FactId: f.factId, Page: rowPages[f.key] || null })),
            }, treeId);
            // Nothing is unsaved any more: clear the guard before the view changes.
            setPeople([]);
            setPage('');
            setQuay('');
            setDataText('');
            onCited(facts.length);
        } catch (err) {
            if (!redirectIfUnauthorized(err)) setError(t('cite_on_failed'));
            setSaving(false);
        } finally {
            onSavingChange?.(false);
        }
    }

    function factRow(p: CiteOnPerson, f: CiteOnFact) {
        const isCited = cited.has(f.key);
        const on = isCited || ticked.has(f.key);
        const boxId = `${idBase}-${f.key}`;
        const label = typeLabel(f.type);
        return (
            <li key={f.key} className="py-1.5">
                <div className="flex items-center gap-2.5 min-h-11 sm:min-h-0">
                    <input
                        id={boxId}
                        type="checkbox"
                        className="w-4 h-4 m-0 accent-primary shrink-0"
                        checked={on}
                        disabled={isCited || saving}
                        onChange={e => toggle(f.key, e.target.checked)}
                    />
                    <label htmlFor={boxId} className="flex-1 min-w-0 text-sm">
                        <span className="font-medium">{label}</span>
                        {f.date && <span className="muted"> · <span className="date-mono">{formatDateForDisplay(f.date, language, dateWords)}</span></span>}
                        {f.place && <span className="text-text-secondary"> · {f.place}</span>}
                    </label>
                    {isCited && <Badge tone="evidence">{t('cite_on_already')}</Badge>}
                </div>
                {!isCited && on && (
                    <div className="mt-1.5 pl-[26px]">
                        <input
                            type="text"
                            value={rowPages[f.key] ?? ''}
                            onChange={e => setRowPages(prev => ({ ...prev, [f.key]: e.target.value }))}
                            className={fieldClass('sm')}
                            // An empty row inherits the default page below (lib/services/citations.ts, #908).
                            placeholder={page.trim() || t('ph_row_page')}
                            aria-label={t('cite_on_row_page', { fact: label, name: personName(p) })}
                            disabled={saving}
                        />
                    </div>
                )}
            </li>
        );
    }

    const pad = isMobile ? 'px-4' : 'px-6';
    const pageId = `${idBase}-page`;
    const certaintyId = `${idBase}-certainty`;
    const transcriptionId = `${idBase}-transcription`;

    return (
        <>
            <div
                className={`flex items-center justify-between gap-3 border-b border-border bg-card ${isMobile ? 'px-4 pb-3' : 'py-[18px] px-6'}`}
                style={isMobile ? { paddingTop: 'max(env(safe-area-inset-top), 18px)' } : undefined}
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <Quote size={16} aria-hidden="true" style={{ color: 'var(--text-secondary)' }} />
                    <h2 id={titleId} className="title-dialog text-text m-0 truncate">
                        {t('cite_on_title', { title: source.Title || t('untitled_source') })}
                    </h2>
                </div>
                <button
                    type="button"
                    onClick={onCancel}
                    title={tc('cancel')}
                    aria-label={tc('cancel')}
                    disabled={saving}
                    className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] -mr-2 rounded text-text-muted hover:text-text hover:bg-[color:var(--color-hover-surface)] transition"
                >
                    <X size={18} aria-hidden="true" />
                </button>
            </div>

            <div ref={bodyRef} className={`flex-1 overflow-y-auto py-4 ${pad}`}>
                <p className="muted text-sm mt-0 mb-3">
                    {t('cite_on_intro')}
                    {year !== null && <> {t('cite_on_year_hint', { year })}</>}
                </p>
                {error && (
                    <div role="alert" className="mb-3 rounded-md text-sm border border-[color:var(--error)] py-2.5 px-3.5" style={{ background: 'var(--error-bg)', color: 'var(--error)' }}>
                        {error}
                    </div>
                )}

                <div className="flex flex-col gap-2 mb-4">
                    <PersonPicker
                        value={null}
                        onChange={p => { if (p) void addPeople([p.Id]); }}
                        showDates
                        treeId={treeId}
                        excludeIds={people.map(p => p.id)}
                        disabled={adding || saving}
                        placeholder={t('cite_on_add_person')}
                    />
                    {householdOpen ? (
                        <div className="inline-panel flex flex-col gap-2" role="group" aria-label={t('cite_on_add_family_members')} data-cite-on-household>
                            <p className="muted text-meta m-0">{t('cite_on_family_members_hint')}</p>
                            <FamilySearch
                                treeId={treeId}
                                disabled={adding || saving}
                                autofillKey="cite-on-household-search"
                                onPick={f => void addHousehold(f.Id)}
                            />
                            <div>
                                <Button variant="ghost" size="sm" onClick={() => setHouseholdOpen(false)}>{tc('cancel')}</Button>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <Button variant="outline" size="sm" icon={<Users size={14} aria-hidden="true" />} onClick={() => setHouseholdOpen(true)} disabled={adding || saving}>
                                {t('cite_on_add_family_members')}
                            </Button>
                        </div>
                    )}
                    {adding && <p role="status" className="muted text-meta m-0">{t('cite_on_adding')}</p>}
                </div>

                {people.length === 0 ? (
                    <div className="text-center text-text-muted border border-dashed border-[color:var(--border)] rounded-[12px] p-5 text-sm mb-4">
                        {t('cite_on_empty')}
                    </div>
                ) : (
                    <>
                        {types.length > 1 && people.length > 1 && (
                            <div className="flex flex-wrap items-center gap-1.5 mb-3" role="group" aria-label={t('cite_on_tick_every')}>
                                <span className="muted text-meta">{t('cite_on_tick_every')}</span>
                                {types.map(type => {
                                    const keys = openFacts.filter(f => f.type === type).map(f => f.key);
                                    const allOn = keys.every(k => ticked.has(k));
                                    return (
                                        <FilterChip key={type} active={allOn} label={typeLabel(type)} onClick={() => toggleType(type)} disabled={saving} />
                                    );
                                })}
                            </div>
                        )}
                        <ul className="list-none m-0 p-0 mb-4 flex flex-col gap-2.5">
                            {people.map(p => {
                                const years = formatLifespan({ birth: formatYearOrEmpty(p.birthDate) || null, death: formatYearOrEmpty(p.deathDate) || null });
                                const headingId = `${idBase}-person-${p.id}`;
                                return (
                                    <li key={p.id} className="border border-border rounded-[12px] py-2 px-3" aria-labelledby={headingId}>
                                        <div className="flex items-center gap-2">
                                            <h3 id={headingId} className="flex-1 min-w-0 text-sm font-semibold m-0 truncate">
                                                {personName(p)}
                                                {years && <span className="muted font-normal"> · <span className="date-mono date-muted">{years}</span></span>}
                                            </h3>
                                            <button
                                                type="button"
                                                onClick={() => removePerson(p)}
                                                disabled={saving}
                                                aria-label={t('cite_on_remove_person', { name: personName(p) })}
                                                title={t('cite_on_remove_person', { name: personName(p) })}
                                                className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] sm:min-w-8 sm:min-h-8 rounded text-text-muted hover:text-text hover:bg-[color:var(--color-hover-surface)] transition"
                                            >
                                                <X size={15} aria-hidden="true" />
                                            </button>
                                        </div>
                                        {p.facts.length === 0 ? (
                                            <p className="muted text-meta mt-1 mb-1">{t('cite_on_no_facts')}</p>
                                        ) : (
                                            <ul className="list-none m-0 p-0">{p.facts.map(f => factRow(p, f))}</ul>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                )}

                <div className="eyebrow mb-2">{t('cite_on_shared')}</div>
                <label htmlFor={pageId} className="block text-meta text-text-secondary mb-1">{t('cite_on_shared_page')}</label>
                <input
                    id={pageId}
                    type="text"
                    value={page}
                    onChange={e => setPage(e.target.value)}
                    className={fieldClass('sm')}
                    placeholder={t('ph_page_optional')}
                    disabled={saving}
                />
                <div id={certaintyId} className="block text-meta text-text-secondary mt-3 mb-1">{t('field_certainty')}</div>
                <CertaintySegments value={quay} onChange={setQuay} idPrefix={`${idBase}-quay`} labelledBy={certaintyId} />
                <label htmlFor={transcriptionId} className="block text-meta text-text-secondary mt-3 mb-1">{t('field_transcription')}</label>
                <textarea
                    id={transcriptionId}
                    value={dataText}
                    onChange={e => setDataText(e.target.value)}
                    rows={2}
                    className={`${fieldClass('sm')} resize-y`}
                    placeholder={t('ph_transcription')}
                    disabled={saving}
                />
            </div>

            <div
                className={`flex items-center justify-end gap-2.5 border-t border-border bg-card-alt ${isMobile ? 'px-3.5 pt-[11px]' : 'py-[13px] px-6'}`}
                style={isMobile ? { paddingBottom: 'max(env(safe-area-inset-bottom), 22px)' } : undefined}
            >
                <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>{tc('cancel')}</Button>
                <Button variant="primary" size="sm" onClick={submit} disabled={saving || count === 0}>
                    {saving ? t('cite_on_citing') : t('cite_on_submit', { count })}
                </Button>
            </div>
        </>
    );
}
