'use client';

import React, { useCallback, useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTree } from '@/app/contexts/TreeContext';
import { getDataClient } from '@/lib/data';
import { errorToastKey } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import { emptySourceForm, type SourceFormState } from '@/app/components/SourceFields';
import { RepositoryPicker } from '@/app/components/RepositoryPicker';
import { SearchRecordsPanel } from '@/app/components/research/SearchRecordsPanel';
import { Input, MobileListChip, MobileRow, citeClass, cx, fieldClass, showChangeToast } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { BookOpen, FileText, LinkIcon, Pencil, Plus, Search } from '@/lib/icons';
import { QUAY_LABEL_KEY, QUAY_VALUES, isQuayValue } from '@/lib/citations/quay';
import { prefillType } from '@/lib/research/links';
import type { ResearchSubject } from '@/lib/research/subject';
import type { FactKind } from '@/lib/research/fact-query';
import type { SiteDefinition } from '@/lib/research/site';
import type { Citation } from '@/lib/db/queries/citations';
import type { PendingCitation } from '@/app/components/AttachSourceSidebar';
import type { CitationFactDescriptor } from './types';
import type { SourceNumbers } from './factDescriptors';
import { CitationLink } from './CitationLink';
import { librarySourceHref } from '@/app/library/links';

/*
 * Citations on phones as sheets (#1049, tracking #1054), standing in for
 * AttachSourceSidebar and the citation preview below `md`:
 * - a pin opens a fit sheet with the citation and rows for Open source ↗, Edit
 *   citation and Cite another source;
 * - Cite a source is one full sheet that steps through pick → (new source) →
 *   where in the source, with Attach in the header, and Search online records as
 *   a step of its own.
 */

const SOURCE_TYPES = ['Census', 'Vital', 'Church', 'Newspaper', 'Oral', 'Document', 'Photo', 'Other'] as const;

interface Source {
    Id: number;
    Title: string | null;
    Type: string | null;
    Author: string | null;
    RepositoryName: string | null;
}

/** Where the sheets open: a pin's citation, Cite a source, one citation's editor, or a viewer's search. */
type CiteSheetStart = 'view' | 'pick' | 'edit' | 'search';

export interface CiteSheetTarget {
    fact: CitationFactDescriptor;
    start: CiteSheetStart;
    /** The pin's citation (`view`) or the one being edited (`edit`). */
    citationId?: number | null;
}

/** Renders the sheets for a target, so a sheet can nest them inside itself (the event sheet's Sources). */
export type CiteSheetsSlot = (target: CiteSheetTarget | null, onClose: () => void) => React.ReactNode;

interface CiteSheetsProps {
    /** Null closes the sheets. */
    target: CiteSheetTarget | null;
    /** Whose fact it is, shown above the source list. */
    subject: string;
    sourceNumbers: SourceNumbers;
    /** Contributors and editors cite and edit; a viewer only reads and searches. */
    canCite: boolean;
    /** Editors also remove citations and get Undo (the audit revert refuses contributors). */
    canDelete: boolean;
    research: ResearchSubject | null;
    onClose: () => void;
    /** A citation was added, changed or removed: reload the page's citations. */
    onChanged: () => void;
    /** A fact with no row yet (a new family's marriage, #1066, or a fact on the phone's
     *  Add person form, #1065): Attach hands the citation here, a new source included,
     *  to be written once the fact exists. */
    onPending?: (pending: PendingCitation) => void;
}

type Step = 'view' | 'pick' | 'new' | 'detail' | 'search';

/** The evidence a citation carries, as the detail step edits it. */
interface Evidence { page: string; quay: string; dataText: string; url: string }
const NO_EVIDENCE: Evidence = { page: '', quay: '', dataText: '', url: '' };

const sameEvidence = (a: Evidence, b: Evidence) =>
    a.page === b.page && a.quay === b.quay && a.dataText === b.dataText && a.url === b.url;

const evidenceOf = (c: Citation): Evidence =>
    ({ page: c.Page ?? '', quay: c.Quay ?? '', dataText: c.DataText ?? '', url: c.Url ?? '' });

const keyOf = (t: CiteSheetTarget) => `${t.fact.factTable}:${t.fact.factId}:${t.start}:${t.citationId ?? ''}`;

const startStep = (t: CiteSheetTarget, canCite: boolean): Step =>
    t.start === 'view' ? 'view' : !canCite || t.start === 'search' ? 'search' : t.start === 'edit' ? 'detail' : 'pick';

export function CiteSheets({ target, subject, sourceNumbers, canCite, canDelete, research, onClose, onChanged, onPending }: CiteSheetsProps) {
    const t = useTranslations('citeSheet');
    const tl = useTranslations('library');
    const tr = useTranslations('research');
    const tc = useTranslations('common');
    const { activeTreeId } = useTree();
    const { redirectIfUnauthorized } = useErrorToast();
    const ids = useId();

    // The last target stays drawn while the sheets animate closed.
    const [shown, setShown] = useState<CiteSheetTarget | null>(target);
    // Empty at first, so the sync below seeds the first target's state too.
    const [shownKey, setShownKey] = useState('');
    const [step, setStep] = useState<Step>(target ? startStep(target, canCite) : 'pick');
    const [citationId, setCitationId] = useState<number | null>(target?.citationId ?? null);
    const [editing, setEditing] = useState(target?.start === 'edit');

    const [q, setQ] = useState('');
    const [type, setType] = useState<string | null>(null);
    const [sources, setSources] = useState<Source[]>([]);
    const [recent, setRecent] = useState<Source[]>([]);
    const [picked, setPicked] = useState<Source | null>(null);
    const [newSource, setNewSource] = useState<SourceFormState>(emptySourceForm);
    const [creating, setCreating] = useState(false);
    const [more, setMore] = useState<{ repository: boolean; author: boolean; link: boolean; contents: boolean }>({ repository: false, author: false, link: false, contents: false });
    const [evidence, setEvidence] = useState<Evidence>(NO_EVIDENCE);
    const [baseline, setBaseline] = useState<Evidence>(NO_EVIDENCE);
    const [reveal, setReveal] = useState({ transcription: false, link: false });
    const [citeSite, setCiteSite] = useState<{ site: SiteDefinition; kind: FactKind } | null>(null);
    const [cited, setCited] = useState<ReadonlySet<string>>(() => new Set());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);

    const fact = target?.fact ?? shown?.fact ?? null;
    const citation = fact?.citations.find((c) => c.Id === citationId) ?? null;

    const resetPick = () => {
        setPicked(null); setCreating(false); setNewSource(emptySourceForm);
        setMore({ repository: false, author: false, link: false, contents: false });
        setEvidence(NO_EVIDENCE); setBaseline(NO_EVIDENCE); setReveal({ transcription: false, link: false });
    };
    const openEditor = (c: Citation) => {
        const e = evidenceOf(c);
        setCitationId(c.Id); setEditing(true); setEvidence(e); setBaseline(e);
        setReveal({ transcription: !!e.dataText, link: !!e.url });
        setError(null); setConfirming(false); setStep('detail');
    };

    // A new target starts over (render-time sync, so no stale step paints).
    if (target && keyOf(target) !== shownKey) {
        setShown(target);
        setShownKey(keyOf(target));
        setStep(startStep(target, canCite));
        setCitationId(target.citationId ?? null);
        setEditing(target.start === 'edit');
        setQ(''); setType(null); resetPick(); setCiteSite(null); setCited(new Set()); setError(null); setConfirming(false);
        const c = target.start === 'edit' ? target.fact.citations.find((x) => x.Id === target.citationId) : undefined;
        if (c) {
            const e = evidenceOf(c);
            setEvidence(e); setBaseline(e); setReveal({ transcription: !!e.dataText, link: !!e.url });
        }
    }
    if (!target && shownKey) setShownKey('');

    const open = target != null;
    const listOpen = open && (step === 'pick' || step === 'new' || step === 'detail' || step === 'search');

    const fetchSources = useCallback(async () => {
        try {
            const client = await getDataClient();
            if (q) {
                setSources(await client.sources.search(q, activeTreeId));
            } else {
                // The recent group is a shortcut: failing it mustn't empty the list.
                const [{ sources: all }, latest] = await Promise.all([
                    client.sources.list({ treeId: activeTreeId }),
                    client.sources.listRecentlyCited(activeTreeId).catch(() => [] as Source[]),
                ]);
                setSources(all);
                setRecent(latest);
            }
        } catch (err) {
            console.error('Failed to load sources', err);
        }
    }, [q, activeTreeId]);

    useEffect(() => {
        if (!listOpen || !canCite) return;
        const timer = setTimeout(fetchSources, q ? 200 : 0);
        return () => clearTimeout(timer);
    }, [fetchSources, listOpen, canCite, q]);

    const showError = (e: unknown, fallback: string) => {
        if (redirectIfUnauthorized(e)) return;
        const key = errorToastKey(e);
        setError(key === 'error_generic' ? fallback : tc(key));
    };

    /** The change toast: Undo for editors when the write left an audit entry. */
    const toast = (message: string, auditIds: number[]) => {
        const undo = canDelete && auditIds.length > 0 ? async () => {
            try {
                const client = await getDataClient();
                await client.audit.revert(auditIds, activeTreeId);
                onChanged();
                showChangeToast({ message: tc('undo_done') });
            } catch {
                showChangeToast({ message: tc('undo_failed') });
            }
        } : undefined;
        showChangeToast({ message, onUndo: undo ? () => { void undo(); } : undefined });
    };

    // Saved: from an online-records search, back to it with that site marked Cited; else close.
    const afterSave = () => {
        if (citeSite) {
            setCited((prev) => new Set(prev).add(citeSite.site.id));
            setCiteSite(null);
            resetPick();
            setStep('search');
        } else {
            onClose();
        }
    };

    const evidenceInput = () => ({
        Page: evidence.page.trim() || null,
        Quay: evidence.quay || null,
        DataText: evidence.dataText.trim() || null,
        Url: evidence.url.trim() || null,
    });

    async function attach() {
        if (!fact || busy) return;
        if (onPending) {
            if (!creating && !picked) return;
            const ev = evidenceInput();
            onPending({
                factTable: fact.factTable,
                factLabel: fact.label,
                page: ev.Page, quay: ev.Quay, dataText: ev.DataText, url: ev.Url,
                ...(creating ? {
                    newSource: {
                        Title: newSource.Title.trim(),
                        Type: newSource.Type,
                        Author: newSource.Author.trim() || null,
                        RepositoryName: newSource.RepositoryName.trim() || null,
                        CallNumber: null,
                        Text: newSource.Text.trim() || null,
                        PublicationInfo: newSource.PublicationInfo.trim() || null,
                        Contents: newSource.Contents.trim() || null,
                    },
                } : { sourceId: picked?.Id, sourceTitle: picked?.Title ?? null }),
            });
            afterSave();
            return;
        }
        setBusy(true); setError(null);
        try {
            const client = await getDataClient();
            let sourceId = picked?.Id;
            if (creating) {
                try {
                    const created = await client.sources.create({
                        Title: newSource.Title.trim(),
                        Type: newSource.Type,
                        Author: newSource.Author.trim() || null,
                        RepositoryName: newSource.RepositoryName.trim() || null,
                        Text: newSource.Text.trim() || null,
                        PublicationInfo: newSource.PublicationInfo.trim() || null,
                        Contents: newSource.Contents.trim() || null,
                    }, activeTreeId);
                    sourceId = created.Id;
                } catch (e) {
                    showError(e, tl('create_failed'));
                    return;
                }
            }
            if (sourceId == null) return;
            try {
                const made = await client.citations.create({ FactTable: fact.factTable, FactId: fact.factId, SourceId: sourceId, ...evidenceInput() }, activeTreeId);
                onChanged();
                toast(creating ? t('toast_created') : t('toast_cited'), made.auditIds);
                afterSave();
            } catch (e) {
                if (creating) {
                    // The source exists now; picking it again won't make a second one.
                    onChanged();
                    setCreating(false);
                    setPicked({ Id: sourceId, Title: newSource.Title.trim(), Type: newSource.Type, Author: null, RepositoryName: newSource.RepositoryName.trim() || null });
                    showError(e, tl('attach_failed_after_create'));
                } else {
                    showError(e, tl('attach_failed'));
                }
            }
        } finally {
            setBusy(false);
        }
    }

    async function saveEdit() {
        if (!citation || busy) return;
        setBusy(true); setError(null);
        try {
            const client = await getDataClient();
            const saved = await client.citations.update(citation.Id, evidenceInput(), activeTreeId);
            onChanged();
            toast(t('toast_updated'), saved.auditIds);
            onClose();
        } catch (e) {
            showError(e, tl('attach_failed'));
        } finally {
            setBusy(false);
        }
    }

    async function remove() {
        if (!citation || busy) return;
        setBusy(true); setError(null);
        try {
            const client = await getDataClient();
            const removed = await client.citations.remove(citation.Id, activeTreeId);
            onChanged();
            toast(t('toast_removed'), removed.auditIds);
            onClose();
        } catch (e) {
            setConfirming(false);
            showError(e, tl('remove_failed'));
        } finally {
            setBusy(false);
        }
    }

    // Found it, cite it (#1029): a new source prefilled with what the site settles.
    function startCite(site: SiteDefinition, kind: FactKind) {
        resetPick();
        setCiteSite({ site, kind });
        setCreating(true);
        setNewSource({
            ...emptySourceForm,
            Title: site.prefill?.title?.[kind] ?? '',
            Type: prefillType(site, kind) ?? emptySourceForm.Type,
            RepositoryName: site.repository.name,
        });
        setMore((m) => ({ ...m, repository: true }));
        setError(null);
        setStep('new');
    }

    if (!fact) return null;

    const factLine = fact.value && fact.value !== fact.label ? `${fact.label} · ${fact.value}` : fact.label;
    const typeLabel = (type: string | null | undefined) => tl(`type_${type && (SOURCE_TYPES as readonly string[]).includes(type) ? type : 'Document'}`);

    /* ── The pin's sheet ─────────────────────────────────────────────────── */

    const viewBody = citation && (
        <>
            <div className="grid gap-1.5 pb-3.5 border-b border-border">
                <div className="flex items-start gap-2">
                    <span className={cx(citeClass(), 'shrink-0 mt-0.5')} aria-hidden="true">{sourceNumbers.get(citation.SourceId)}</span>
                    <h3 className="m-0 text-md font-semibold leading-snug text-text">{citation.sourceTitle ?? tl('untitled_source')}</h3>
                </div>
                <p className="m-0 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-text-muted">
                    <span>{[typeLabel(citation.sourceType), citation.sourceRepo].filter(Boolean).join(' · ')}</span>
                    {isQuayValue(citation.Quay) && (
                        <span className="inline-block px-2 py-px rounded-full bg-surface-2 text-text font-semibold">{tl(`certainty_short_${citation.Quay}`)}</span>
                    )}
                </p>
                {citation.Page && <p className="m-0 text-meta text-text-muted">{citation.Page}</p>}
                {citation.Url && <CitationLink url={citation.Url} className="self-start min-h-11" />}
                {citation.DataText && (
                    <blockquote className="m-0 mt-1 pl-2.5 border-l-2 border-evidence-border serif italic text-base leading-relaxed text-text">
                        {citation.DataText}
                    </blockquote>
                )}
            </div>
            <div className="-mx-4">
                <MobileRow icon={<BookOpen />} label={tl('open_source')} end="leave" href={librarySourceHref(citation.SourceId)} />
                {canCite && (
                    <>
                        <MobileRow divided icon={<Pencil />} label={tl('edit_citation')} end="chevron" onClick={() => openEditor(citation)} />
                        <MobileRow divided icon={<Plus />} label={t('cite_another')} end="chevron" onClick={() => { resetPick(); setError(null); setStep('pick'); }} />
                    </>
                )}
            </div>
        </>
    );

    /* ── Cite a source: pick ─────────────────────────────────────────────── */

    const byType = (list: Source[]) => (type ? list.filter((s) => (s.Type ?? 'Document') === type) : list);
    const recentShown = q ? [] : byType(recent);
    const recentIds = new Set(recentShown.map((s) => s.Id));
    const rest = byType(sources).filter((s) => !recentIds.has(s.Id));
    const pick = (s: Source) => { setPicked(s); setCreating(false); setError(null); setStep('detail'); };
    const sourceRow = (s: Source, divided: boolean) => (
        <MobileRow key={s.Id} divided={divided} lead={<SourceTile />} label={s.Title ?? tl('untitled_source')}
            sub={[typeLabel(s.Type), s.RepositoryName].filter(Boolean).join(' · ')} onClick={() => pick(s)} />
    );

    const pickBody = (
        <>
            <p className="m-0 pt-1 text-sm text-text-secondary truncate">{subject} · <b className="font-semibold text-text">{factLine}</b></p>
            <div className="relative mt-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" aria-hidden="true" />
                <input type="search" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search_placeholder')}
                    aria-label={t('search_placeholder')} className={cx(fieldClass(), '!min-h-11 pl-9')} />
            </div>
            <div role="group" aria-label={tl('field_type')} className="flex gap-1.5 overflow-x-auto hscroll-strip -mx-4 px-4 pt-3 pb-1">
                {SOURCE_TYPES.map((x) => (
                    <MobileListChip key={x} active={type === x} label={typeLabel(x)} onClick={() => setType(type === x ? null : x)} />
                ))}
            </div>
            <div className="-mx-4 mt-1">
                <MobileRow icon={<Plus />} end="chevron" onClick={() => {
                    resetPick(); setCreating(true); setError(null);
                    setNewSource({ ...emptySourceForm, Title: q.trim(), Type: type ?? emptySourceForm.Type });
                    setStep('new');
                }} label={q.trim() ? t('create_named', { name: q.trim() }) : t('create_new')} />
                {recentShown.length > 0 && (
                    <div role="group" aria-labelledby={`${ids}-recent`}>
                        <h3 id={`${ids}-recent`} className="eyebrow m-0 px-4 pt-4 pb-1 border-t border-border">{tl('recently_cited')}</h3>
                        {recentShown.map((s, i) => sourceRow(s, i > 0))}
                    </div>
                )}
                {rest.length > 0 && (
                    <div role="group" aria-labelledby={recentShown.length > 0 ? `${ids}-all` : undefined}>
                        {recentShown.length > 0
                            ? <h3 id={`${ids}-all`} className="eyebrow m-0 px-4 pt-4 pb-1 border-t border-border">{tl('all_sources')}</h3>
                            : null}
                        {rest.map((s, i) => sourceRow(s, recentShown.length === 0 || i > 0))}
                    </div>
                )}
                {recentShown.length === 0 && rest.length === 0 && (q || type) && (
                    <p className="m-0 px-4 py-4 border-t border-border text-base text-text-muted">{t('no_match')}</p>
                )}
                {research && (
                    <MobileRow divided icon={<Search />} label={t('search_online')} end="chevron" onClick={() => { setError(null); setStep('search'); }} />
                )}
            </div>
        </>
    );

    /* ── New source ──────────────────────────────────────────────────────── */

    const patchSource = (patch: Partial<SourceFormState>) => setNewSource((prev) => ({ ...prev, ...patch }));
    const sourceDirty = newSource.Title.trim() !== '' || newSource.Author !== '' || newSource.RepositoryName !== ''
        || newSource.Text !== '' || newSource.PublicationInfo !== '' || newSource.Contents !== '';
    const newBody = (
        <>
            {citeSite && <p className="m-0 pt-1 text-sm text-text-secondary">{tr('cite_from', { site: citeSite.site.name })}</p>}
            <div className="grid gap-3.5 pt-3 pb-4">
                <Input id={`${ids}-title`} label={tl('field_title_label')} placeholder={t('title_ph')} value={newSource.Title}
                    onChange={(e) => patchSource({ Title: e.target.value })} className="!min-h-11" />
                <div className="grid gap-1.5">
                    <span id={`${ids}-type`} className="text-sm font-medium text-text-secondary">{tl('field_type')}</span>
                    <div role="group" aria-labelledby={`${ids}-type`} className="flex flex-wrap gap-x-1.5 gap-y-2.5">
                        {SOURCE_TYPES.map((x) => (
                            <MobileListChip key={x} active={newSource.Type === x}
                                label={typeLabel(x)} onClick={() => patchSource({ Type: x })} />
                        ))}
                    </div>
                </div>
            </div>
            <div className="-mx-4 border-t border-border">
                {more.repository ? (
                    <div className="px-4 py-3">
                        <RepositoryPicker id={`${ids}-repo`} label={tl('field_repository')} treeId={activeTreeId} value={newSource.RepositoryName}
                            onChange={(RepositoryName) => patchSource({ RepositoryName })} automatic={citeSite?.site.repository.name} />
                    </div>
                ) : <MobileRow icon={<BookOpen />} label={t('row_repository')} end="chevron" onClick={() => setMore((m) => ({ ...m, repository: true }))} />}
                {more.author ? (
                    <div className="grid gap-3 px-4 py-3 border-t border-border">
                        <Input id={`${ids}-author`} label={tl('field_author')} value={newSource.Author}
                            onChange={(e) => patchSource({ Author: e.target.value })} className="!min-h-11" />
                        <Input id={`${ids}-pub`} label={tl('field_publication')} placeholder={tl('ph_publication_short')} value={newSource.PublicationInfo}
                            onChange={(e) => patchSource({ PublicationInfo: e.target.value })} className="!min-h-11" />
                    </div>
                ) : <MobileRow divided icon={<Pencil />} label={t('row_author')} end="chevron" onClick={() => setMore((m) => ({ ...m, author: true }))} />}
                {more.link ? (
                    <div className="px-4 py-3 border-t border-border">
                        <Input id={`${ids}-src-url`} type="url" inputMode="url" autoComplete="off" label={tl('field_url')} placeholder={tl('ph_url')}
                            value={newSource.Text} onChange={(e) => patchSource({ Text: e.target.value })} className="!min-h-11" />
                    </div>
                ) : <MobileRow divided icon={<LinkIcon />} label={t('row_link')} end="chevron" onClick={() => setMore((m) => ({ ...m, link: true }))} />}
                {more.contents ? (
                    <label className="grid gap-1.5 px-4 py-3 border-t border-border">
                        <span className="text-sm font-medium text-text-secondary">{tl('field_contents_label')}</span>
                        <textarea id={`${ids}-contents`} rows={4} value={newSource.Contents} onChange={(e) => patchSource({ Contents: e.target.value })}
                            placeholder={tl('ph_contents_short')} className={cx(fieldClass(), 'resize-none')} />
                    </label>
                ) : <MobileRow divided icon={<FileText />} label={t('row_contents')} end="chevron" onClick={() => setMore((m) => ({ ...m, contents: true }))} />}
            </div>
            <p className="m-0 pt-3 text-meta text-text-muted">{t('new_hint')}</p>
        </>
    );

    /* ── Where in the source (attach, or edit a citation) ────────────────── */

    const setEv = (patch: Partial<Evidence>) => setEvidence((prev) => ({ ...prev, ...patch }));
    const summary = editing
        ? citation && { title: citation.sourceTitle, type: citation.sourceType, repo: citation.sourceRepo }
        : creating
            ? { title: newSource.Title.trim(), type: newSource.Type, repo: newSource.RepositoryName.trim() || null }
            : picked && { title: picked.Title, type: picked.Type, repo: picked.RepositoryName };
    const detailBody = summary && (
        <>
            <div className="flex items-center gap-3 pt-2 pb-3">
                <SourceTile />
                <span className="flex-1 min-w-0 grid gap-px">
                    <b className="text-base font-semibold leading-snug text-text">{summary.title || tl('untitled_source')}</b>
                    <span className="text-meta text-text-muted">{[typeLabel(summary.type), summary.repo || tl('no_repository')].join(' · ')}</span>
                </span>
                {!editing && (
                    <button type="button" onClick={() => setStep(creating ? 'new' : 'pick')}
                        className="relative shrink-0 text-sm font-medium text-link cursor-pointer before:absolute before:-inset-3 before:content-[''] focus-ring">
                        {t('change')}
                    </button>
                )}
            </div>
            <section className="grid gap-2.5 py-4 border-t border-border">
                <h3 className="eyebrow m-0">{t('where')}</h3>
                <Input id={`${ids}-page`} label={t('page_label')} placeholder={t('page_ph')} hint={t('page_hint')} value={evidence.page}
                    onChange={(e) => setEv({ page: e.target.value })} className="!min-h-11" />
            </section>
            <section className="grid gap-2.5 py-4 border-t border-border">
                <h3 id={`${ids}-quay`} className="eyebrow m-0">{tl('field_certainty')}</h3>
                <div role="group" aria-labelledby={`${ids}-quay`} className="flex flex-wrap gap-x-1.5 gap-y-2.5">
                    {QUAY_VALUES.map((v) => (
                        <MobileListChip key={v} active={evidence.quay === v}
                            label={tl(`certainty_short_${v}`)} title={tl(QUAY_LABEL_KEY[v])} onClick={() => setEv({ quay: evidence.quay === v ? '' : v })} />
                    ))}
                </div>
                <span className="text-meta text-text-muted">{t('certainty_hint')}</span>
            </section>
            <div className="-mx-4 border-t border-border">
                {reveal.transcription ? (
                    <label className="grid gap-1.5 px-4 py-3">
                        <span className="text-sm font-medium text-text-secondary">{tl('field_transcription')}</span>
                        <textarea rows={4} value={evidence.dataText} onChange={(e) => setEv({ dataText: e.target.value })}
                            placeholder={t('transcription_ph')} className={cx(fieldClass(), 'resize-none')} />
                    </label>
                ) : <MobileRow icon={<Pencil />} label={t('add_transcription')} end="chevron" onClick={() => setReveal((r) => ({ ...r, transcription: true }))} />}
                {reveal.link ? (
                    <div className="px-4 py-3 border-t border-border">
                        <Input id={`${ids}-url`} type="url" inputMode="url" autoComplete="off" label={tl('field_record_link')} placeholder={tl('ph_record_link')}
                            value={evidence.url} onChange={(e) => setEv({ url: e.target.value })} className="!min-h-11" />
                    </div>
                ) : <MobileRow divided icon={<LinkIcon />} label={t('add_link')} end="chevron" onClick={() => setReveal((r) => ({ ...r, link: true }))} />}
                {editing && canDelete && (
                    <MobileRow divided tone="danger" label={t('remove')} onClick={() => setConfirming(true)} />
                )}
            </div>
        </>
    );

    /* ── The full sheet's header and body for the current step ───────────── */

    const detailDirty = !sameEvidence(evidence, baseline);
    const backTo = (to: Step) => () => { setError(null); setStep(to); };
    const flow: Pick<React.ComponentProps<typeof Sheet>, 'title' | 'onBack' | 'onSave' | 'saveLabel' | 'saveDisabled' | 'dirty' | 'saveWhenClean' | 'backKeepsChanges'> & { body: React.ReactNode } =
        step === 'search' ? {
            title: tr('tab'),
            onBack: canCite && shown?.start !== 'search' ? backTo('pick') : undefined,
            body: research && (
                <div className="-mx-4 -mt-3">
                    <SearchRecordsPanel subject={research} canCite={canCite} cited={cited} onFound={startCite} />
                </div>
            ),
        } : step === 'new' ? {
            title: t('new_title'),
            onBack: () => { setError(null); if (citeSite) { setCiteSite(null); resetPick(); setStep('search'); } else { setCreating(false); setStep('pick'); } },
            onSave: () => { setError(null); setEvidence(NO_EVIDENCE); setBaseline(NO_EVIDENCE); setStep('detail'); },
            saveLabel: t('next'),
            saveDisabled: !newSource.Title.trim(),
            dirty: sourceDirty,
            body: newBody,
        } : step === 'detail' ? {
            title: editing ? tl('edit_citation') : t('cite_step_title'),
            onBack: editing ? (shown?.start === 'view' ? backTo('view') : undefined) : backTo(creating ? 'new' : 'pick'),
            onSave: editing ? saveEdit : attach,
            saveLabel: editing ? undefined : t('attach'),
            saveDisabled: busy,
            dirty: editing ? detailDirty : detailDirty || creating,
            saveWhenClean: !editing,
            // Back to the list or the new source keeps the details typed here.
            backKeepsChanges: !editing,
            body: detailBody,
        } : {
            title: t('cite_title'),
            onBack: shown?.start === 'view' ? backTo('view') : undefined,
            body: pickBody,
        };

    return (
        <>
            <Sheet open={open && step === 'view'} onClose={onClose} title={factLine}>
                {viewBody}
            </Sheet>
            <Sheet open={listOpen} onClose={onClose} size="full" title={flow.title} onBack={flow.onBack}
                onSave={flow.onSave} saveLabel={flow.saveLabel} saveDisabled={flow.saveDisabled} dirty={flow.dirty} saveWhenClean={flow.saveWhenClean} backKeepsChanges={flow.backKeepsChanges}>
                {error && (
                    <p role="alert" className="m-0 -mx-4 -mt-3 mb-2 px-4 py-2.5 text-sm bg-error-bg text-error border-b border-border">{error}</p>
                )}
                {flow.body}
                {confirming && citation && (
                    <RemoveConfirm fact={fact.label} busy={busy} onRemove={() => { void remove(); }} onKeep={() => setConfirming(false)} />
                )}
            </Sheet>
        </>
    );
}

/** The 34px tile in front of a source. */
function SourceTile() {
    return (
        <span aria-hidden="true" className="grid place-items-center w-[34px] h-[34px] shrink-0 rounded-[9px] bg-surface-2 text-text-secondary [&_svg]:w-[18px] [&_svg]:h-[18px]">
            <BookOpen />
        </span>
    );
}

/**
 * Removing a citation asks once (design-system.md → Mobile → Feedback): a card rising
 * from the bottom of the sheet that says the source stays, with the red pill and an
 * ink Keep. It sits inside the sheet so the sheet's focus trap holds it.
 */
function RemoveConfirm({ fact, busy, onRemove, onKeep }: { fact: string; busy: boolean; onRemove: () => void; onKeep: () => void }) {
    const t = useTranslations('citeSheet');
    const ids = useId();
    const keep = React.useRef<HTMLButtonElement>(null);
    useEffect(() => { keep.current?.focus(); }, []);
    return (
        <div className="absolute inset-0 z-10 flex items-end p-2.5 bg-black/40 rounded-t-[20px]">
            <div role="alertdialog" aria-modal="true" aria-labelledby={`${ids}-t`} aria-describedby={`${ids}-b`}
                className="w-full grid gap-2.5 bg-card rounded-[20px] px-4 pt-[18px] pb-1 shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
>
                <h2 id={`${ids}-t`} className="m-0 text-md font-semibold text-text">{t('remove_title', { fact })}</h2>
                <p id={`${ids}-b`} className="m-0 mb-1 text-base text-text-secondary">{t('remove_body')}</p>
                <button type="button" onClick={onRemove} disabled={busy}
                    className="w-full min-h-11 rounded-full bg-button-danger text-white text-base font-semibold cursor-pointer focus-ring disabled:opacity-60">
                    {t('remove_confirm')}
                </button>
                <button ref={keep} type="button" onClick={onKeep}
                    className="w-full min-h-11 text-base font-semibold text-text cursor-pointer rounded-lg focus-ring">
                    {t('keep')}
                </button>
            </div>
        </div>
    );
}
