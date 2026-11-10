'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, SegmentedControl, buttonClass, cx, fieldClass } from '@/app/components/ui';
import { ExternalLink } from '@/app/components/ExternalLink';
import { Copy, ExternalLink as ExternalLinkIcon } from '@/lib/icons';
import { buildResearchQuery, readiness, researchPlaceText, type FactKind } from '@/lib/research/fact-query';
import { detailIds, detailValue, editedQuery, initialEdits, type DetailEdits, type DetailId } from '@/lib/research/details';
import { siteSearch, sitesFor, type SiteSearch } from '@/lib/research/links';
import type { SiteDefinition } from '@/lib/research/site';
import type { ResearchSubject } from '@/lib/research/subject';
import { getDataClient } from '@/lib/data';
import { useActiveTreeIdIfAny } from '@/app/contexts/TreeContext';

type Outcome = 'opened' | 'none';

const READINESS_TONE = { ready: 'green', thin: 'warning', not_enough: 'neutral' } as const;

interface SearchRecordsPanelProps {
    subject: ResearchSubject;
    /** Viewers search but can't cite, so the outcome buttons are hidden from them. */
    canCite: boolean;
    /** Sites a find was cited from in this sidebar. */
    cited?: ReadonlySet<string>;
    onFound?: (site: SiteDefinition, kind: FactKind) => void;
}

/**
 * The gazetteer chain (root first) of the place a search sends, so a place written
 * without its country takes the one it is filed under (#1030). Empty until it
 * loads, outside a tree, or when the lookup fails: the text alone then decides.
 */
const NO_ANCESTRY: string[] = [];

function usePlaceAncestry(place: string | null): string[] {
    const treeId = useActiveTreeIdIfAny();
    const [loaded, setLoaded] = useState<{ place: string; names: string[] } | null>(null);
    useEffect(() => {
        if (!place?.trim() || treeId == null) return;
        let cancelled = false;
        getDataClient().then(client => client.places.pinChains([place], treeId))
            .then(chains => { if (!cancelled) setLoaded({ place, names: (chains[place] ?? []).map(row => row.name) }); })
            .catch(() => { /* the comma rule still applies */ });
        return () => { cancelled = true; };
    }, [place, treeId]);
    return loaded && loaded.place === place ? loaded.names : NO_ANCESTRY;
}

/**
 * Source this fact's Search records tab (#1017 section 1, layout B3; #1028).
 * The details box is the whole search form: each chip is a detail every link
 * sends, edited in place, left out with × and added back from a dashed chip.
 * Each offered site below opens in one click; nothing is fetched.
 */
export function SearchRecordsPanel({ subject, canCite, cited, onFound }: SearchRecordsPanelProps) {
    const t = useTranslations('research');
    const ancestry = usePlaceAncestry(researchPlaceText(subject.input));
    const base = useMemo(() => buildResearchQuery(subject.input, ancestry), [subject.input, ancestry]);
    const [edits, setEdits] = useState<DetailEdits>(() => initialEdits(base));
    const [editing, setEditing] = useState<DetailId | null>(null);
    const [moreOpen, setMoreOpen] = useState(false);
    const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
    const id = useId();
    const titleId = `${id}-title`;
    const editorId = `${id}-editor`;
    const moreId = `${id}-more`;
    const chipRefs = useRef<Partial<Record<DetailId, HTMLButtonElement | null>>>({});
    const lastEditing = useRef<DetailId | null>(null);

    const query = editedQuery(base, edits);
    const ready = readiness(query);
    const searches = sitesFor(query).map(site => siteSearch(site, query));
    const ids = detailIds(base);

    // Closing an editor returns focus to its chip.
    useEffect(() => {
        if (editing) lastEditing.current = editing;
        else if (lastEditing.current) {
            chipRefs.current[lastEditing.current]?.focus();
            lastEditing.current = null;
        }
    }, [editing]);

    const label = (detail: DetailId) => t(`details.${detail}`);
    const shown = (detail: DetailId) => {
        const value = detailValue(edits, detail);
        if (detail === 'sex' && value) return t(`sex_${value as 'F' | 'M'}`);
        return value;
    };

    function patch(next: Partial<DetailEdits>) {
        setEdits(prev => ({ ...prev, ...next }));
    }

    function leaveOut(detail: DetailId) {
        setEdits(prev => ({ ...prev, dropped: [...prev.dropped, detail] }));
        if (editing === detail) setEditing(null);
    }

    function restore(detail: DetailId) {
        setEdits(prev => ({ ...prev, dropped: prev.dropped.filter(d => d !== detail) }));
    }

    function setOutcome(siteId: string, outcome: Outcome) {
        setOutcomes(prev => ({ ...prev, [siteId]: outcome }));
    }

    const reasonsLine = ready.reasons.map(r => t(`readiness.${r}`)).join(' · ');

    return (
        <div className="flex flex-col gap-3 p-3">
            <section aria-labelledby={titleId} className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-card-alt p-3">
                <div className="flex items-center justify-between gap-2">
                    <h3 id={titleId} className="text-sm font-semibold text-text" style={{ margin: 0 }}>{t('details_title')}</h3>
                    <Badge tone={READINESS_TONE[ready.level]}>{t(`readiness.${ready.level}`)}</Badge>
                </div>
                <ul className="flex flex-wrap gap-1.5" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {ids.map(detail => {
                        const value = shown(detail);
                        const dropped = edits.dropped.includes(detail);
                        const open = editing === detail;
                        const ref = (el: HTMLButtonElement | null) => { chipRefs.current[detail] = el; };
                        if (dropped || !value) {
                            return (
                                <li key={detail}>
                                    <button
                                        ref={ref}
                                        type="button"
                                        onClick={() => (dropped ? restore(detail) : setEditing(open ? null : detail))}
                                        aria-expanded={dropped ? undefined : open}
                                        aria-controls={dropped || !open ? undefined : editorId}
                                        aria-label={dropped ? t('restore_detail', { label: label(detail) }) : t('add_detail', { label: label(detail) })}
                                        className="min-h-8 rounded-full border border-dashed border-border px-2.5 text-meta text-link cursor-pointer hover:bg-hover-surface focus-ring"
                                        style={{ background: 'transparent' }}
                                    >
                                        + {label(detail)}
                                    </button>
                                </li>
                            );
                        }
                        return (
                            <li key={detail} className={cx('inline-flex max-w-full items-center rounded-full border bg-card', open ? 'border-text' : 'border-border')}>
                                <button
                                    ref={ref}
                                    type="button"
                                    onClick={() => setEditing(open ? null : detail)}
                                    aria-expanded={open}
                                    aria-controls={open ? editorId : undefined}
                                    className="min-h-8 min-w-0 rounded-l-full py-1 pl-2.5 pr-1 text-left text-meta text-text cursor-pointer focus-ring"
                                    style={{ background: 'transparent', border: 'none', overflowWrap: 'anywhere' }}
                                >
                                    <span className="text-text-muted">{label(detail)}</span> {value}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => leaveOut(detail)}
                                    aria-label={t('leave_out', { label: label(detail) })}
                                    title={t('leave_out', { label: label(detail) })}
                                    className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-text-muted cursor-pointer hover:bg-hover-surface hover:text-text focus-ring"
                                    style={{ background: 'transparent', border: 'none' }}
                                >
                                    <span aria-hidden="true">×</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
                {editing && (
                    <DetailEditor
                        id={editorId}
                        detail={editing}
                        label={label(editing)}
                        edits={edits}
                        surnames={[base.surname, base.altSurname ?? ''].filter(Boolean)}
                        onChange={patch}
                        onDone={() => setEditing(null)}
                    />
                )}
                {reasonsLine && <p className="text-xs text-text-secondary" style={{ margin: 0 }}>{reasonsLine}</p>}
                {subject.mayBeLiving && (
                    <p className="text-xs text-warning-text" style={{ margin: 0 }}>
                        {subject.firstName ? t('living_named', { name: subject.firstName }) : t('living')}
                    </p>
                )}
                <p className="text-xs text-text-secondary" style={{ margin: 0 }}>{t('footer')}</p>
                <div>
                    <button
                        type="button"
                        onClick={() => setMoreOpen(o => !o)}
                        aria-expanded={moreOpen}
                        aria-controls={moreId}
                        className="text-xs text-link hover:underline cursor-pointer focus-ring"
                        style={{ background: 'none', border: 'none', padding: 0 }}
                    >
                        {moreOpen ? t('less') : t('more')}
                    </button>
                    <p id={moreId} hidden={!moreOpen} className="mt-1 text-xs text-text-muted" style={{ marginBottom: 0 }}>{t('footer_more')}</p>
                </div>
            </section>
            <ul aria-label={t('sites_label')} className="flex flex-col" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {searches.map(search => (
                    <SiteRow
                        key={search.site.id}
                        search={search}
                        kind={query.kind}
                        outcome={cited?.has(search.site.id) ? 'cited' : outcomes[search.site.id]}
                        canCite={canCite}
                        onOpened={() => {
                            if (!cited?.has(search.site.id)) setOutcome(search.site.id, 'opened');
                        }}
                        onNothing={() => setOutcome(search.site.id, 'none')}
                        onFound={() => onFound?.(search.site, query.kind)}
                    />
                ))}
            </ul>
        </div>
    );
}

interface DetailEditorProps {
    id: string;
    detail: DetailId;
    label: string;
    edits: DetailEdits;
    /** The builder's surname and its maiden or married alternative, offered as one-tap swaps. */
    surnames: string[];
    onChange: (patch: Partial<DetailEdits>) => void;
    onDone: () => void;
}

/** The inline editor under the chips. Enter or Done closes it; Escape does too, without closing the sidebar. */
function DetailEditor({ id, detail, label, edits, surnames, onChange, onDone }: DetailEditorProps) {
    const t = useTranslations('research');
    const tc = useTranslations('common');
    const groupRef = useRef<HTMLDivElement>(null);
    const fieldId = useId();

    useEffect(() => {
        groupRef.current?.querySelector<HTMLElement>('input, button[role="radio"]')?.focus();
    }, [detail]);

    function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onDone();
        } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            onDone();
        }
    }

    const input = (key: 'given' | 'surname' | 'yearFrom' | 'yearTo' | 'place' | 'spouseGiven' | 'spouseSurname', text: string, numeric = false) => (
        <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-text-muted">{text}</span>
            <input
                id={`${fieldId}-${key}`}
                type="text"
                inputMode={numeric ? 'numeric' : undefined}
                autoComplete="off"
                value={edits[key]}
                onChange={e => onChange({ [key]: e.target.value })}
                className={cx(fieldClass('sm'), numeric && 'font-mono')}
            />
        </label>
    );

    const swaps = [...new Set(surnames)].filter(s => s.toLowerCase() !== edits.surname.trim().toLowerCase());

    return (
        <div ref={groupRef} id={id} role="group" aria-label={t('edit_detail', { label })} onKeyDown={onKeyDown} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5">
            {detail === 'given' && input('given', t('editor.given'))}
            {detail === 'surname' && (
                <>
                    {input('surname', t('editor.surname'))}
                    {swaps.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-text-muted">{t('use_surname')}</span>
                            {swaps.map(s => (
                                <Button key={s} variant="outline" size="sm" onClick={() => onChange({ surname: s })}>{s}</Button>
                            ))}
                        </div>
                    )}
                </>
            )}
            {detail === 'years' && (
                <div className="flex gap-2">
                    {input('yearFrom', t('editor.year_from'), true)}
                    {input('yearTo', t('editor.year_to'), true)}
                </div>
            )}
            {detail === 'place' && input('place', t('editor.place'))}
            {detail === 'spouse' && (
                <div className="flex flex-col gap-2">
                    {input('spouseGiven', t('editor.spouse_given'))}
                    {input('spouseSurname', t('editor.spouse_surname'))}
                </div>
            )}
            {detail === 'sex' && (
                <SegmentedControl
                    aria-label={label}
                    value={edits.sex}
                    options={[{ v: 'F', l: t('sex_F') }, { v: 'M', l: t('sex_M') }]}
                    onChange={v => onChange({ sex: v as 'F' | 'M' })}
                />
            )}
            <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={onDone}>{tc('done')}</Button>
            </div>
        </div>
    );
}

interface SiteRowProps {
    search: SiteSearch;
    kind: FactKind;
    outcome: Outcome | 'cited' | undefined;
    canCite: boolean;
    onOpened: () => void;
    onNothing: () => void;
    onFound: () => void;
}

function SiteRow({ search, kind, outcome, canCite, onOpened, onNothing, onFound }: SiteRowProps) {
    const t = useTranslations('research');
    const { site, blocked } = search;
    const nameId = useId();
    const [copied, setCopied] = useState<string | null>(null);

    const reason = blocked ? t(`reasons.${blocked.key}`, 'year' in blocked ? { year: blocked.year } : {}) : null;
    const summary = `${t(`sites.${site.id}.searches`, { kind })} · ${t(`sites.${site.id}.note`)}`;
    const state = outcome === 'cited' ? t('state_cited') : outcome === 'none' ? t('state_none') : outcome === 'opened' ? t('state_opened') : null;

    async function copy(fieldLabel: string, value: string) {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(fieldLabel);
        } catch {
            setCopied(null);
        }
    }

    const openClass = cx(buttonClass({ variant: 'outline', size: 'sm' }), 'shrink-0 gap-1.5 no-underline');

    return (
        <li className={cx('flex flex-col gap-2 border-t border-border py-2.5 px-1 first:border-t-0', blocked && 'opacity-70')}>
            <div className="flex items-center gap-2.5">
                <div className="min-w-0 flex-1">
                    <div id={nameId} className="text-sm font-medium text-text">
                        {site.name}
                        {state && <span className={cx('ml-1.5 text-xs font-semibold', outcome === 'cited' ? 'text-success' : 'text-text-muted')}>· {state}</span>}
                    </div>
                    <div className="text-xs text-text-muted">{reason ?? summary}</div>
                </div>
                {blocked ? (
                    <Button variant="outline" size="sm" disabled aria-label={t('open_site', { site: site.name })}>{t('open')}</Button>
                ) : (
                    <ExternalLink href={search.url} onClick={onOpened} className={openClass} aria-label={t('open_site', { site: site.name })}>
                        <ExternalLinkIcon size={14} aria-hidden="true" />{t('open')}
                    </ExternalLink>
                )}
            </div>
            {search.alternates.map(alt => (
                <div key={alt.url} className="flex items-center gap-2.5">
                    <div className="min-w-0 flex-1 text-xs text-text-secondary">{t('also_try', { label: alt.label })}</div>
                    <ExternalLink href={alt.url} onClick={onOpened} className={cx(buttonClass({ variant: 'ghost', size: 'sm' }), 'shrink-0 gap-1.5 no-underline')} aria-label={t('open_alternate', { site: site.name, label: alt.label })}>
                        <ExternalLinkIcon size={14} aria-hidden="true" />{t('open')}
                    </ExternalLink>
                </div>
            ))}
            {!blocked && outcome && search.fields.length > 0 && (
                <dl className="grid items-center gap-x-2.5 gap-y-1 text-xs" style={{ gridTemplateColumns: 'auto minmax(0,1fr)', margin: 0 }}>
                    {search.fields.map(field => {
                        const fieldLabel = t(`fields.${field.label}`);
                        return (
                            <div key={field.label} className="contents">
                                <dt className="text-text-muted">{fieldLabel}</dt>
                                <dd className="flex min-w-0 items-center justify-between gap-2" style={{ margin: 0 }}>
                                    <span className="font-mono text-text" style={{ overflowWrap: 'anywhere' }}>{field.value}</span>
                                    <button
                                        type="button"
                                        onClick={() => copy(fieldLabel, field.value)}
                                        aria-label={t('copy', { label: fieldLabel })}
                                        title={t('copy', { label: fieldLabel })}
                                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-muted cursor-pointer hover:bg-hover-surface hover:text-text focus-ring"
                                        style={{ background: 'transparent', border: 'none' }}
                                    >
                                        <Copy size={14} aria-hidden="true" />
                                    </button>
                                </dd>
                            </div>
                        );
                    })}
                </dl>
            )}
            <span role="status" className="sr-only">{copied ? t('copied', { label: copied }) : ''}</span>
            {canCite && outcome === 'opened' && (
                <div role="group" aria-labelledby={nameId} className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-0.5 text-xs text-text-muted">{t('did_it_have')}</span>
                    <Button variant="outline" size="sm" onClick={onFound}>{t('found_it')}</Button>
                    <Button variant="ghost" size="sm" onClick={onNothing}>{t('nothing_found')}</Button>
                </div>
            )}
        </li>
    );
}
