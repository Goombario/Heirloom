'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useTree } from '@/app/contexts/TreeContext';
import { getDataClient } from '@/lib/data';
import type { FactTableValue } from '@/lib/db/fact-tables';
import { errorToastKey } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import { SourceFields, SourceFormState, emptySourceForm } from '@/app/components/SourceFields';
import { Button, Badge, fieldClass, cx } from '@/app/components/ui';
import { QUAY_LABEL_KEY, isQuayValue } from '@/lib/citations/quay';
import { CertaintySegments } from '@/app/components/citations/CertaintySegments';
import { quayTone } from '@/app/components/citations/quayTone';
import { CitationLink } from '@/app/components/citations/CitationLink';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { useFocusTrap } from '@/app/hooks/useFocusTrap';
import { SearchRecordsPanel } from '@/app/components/research/SearchRecordsPanel';
import type { ResearchSubject } from '@/lib/research/subject';
import type { FactKind } from '@/lib/research/fact-query';
import { prefillType } from '@/lib/research/links';
import type { SiteDefinition } from '@/lib/research/site';
import { librarySourceHref } from '@/app/library/links';

interface Source {
    Id: number;
    Title: string | null;
    Type: string | null;
    Author: string | null;
    RepositoryName: string | null;
}

export interface PendingCitation {
    factTable: string;
    factLabel: string;
    page: string | null;
    /** GEDCOM QUAY certainty ('0'–'3') and DATA.TEXT transcription, both optional. */
    quay?: string | null;
    dataText?: string | null;
    /** The link to the record (`Citation.Url`, ADR 0025), optional. */
    url?: string | null;
    // Either an existing source...
    sourceId?: number;
    sourceTitle?: string | null;
    // ...or a new source to create at flush time:
    newSource?: {
        Title: string;
        Type: string;
        Author: string | null;
        RepositoryName: string | null;
        CallNumber: string | null;
        Text: string | null;
        PublicationInfo: string | null;
        Contents: string | null;
    };
}

/** A citation offered to copy (#34): picking it prefills the source and its detail. */
export interface CitationPick {
    key: string;
    sourceId: number;
    sourceTitle: string | null;
    sourceType: string | null;
    sourceRepo: string | null;
    page: string | null;
    quay: string | null;
    dataText: string | null;
    url: string | null;
    /** Whose citation it is ("Hazel Arbor"), shown before the detail. */
    context: string | null;
}

export interface CitationPickGroup {
    id: string;
    label: string;
    picks: CitationPick[];
}

interface ExistingCitation {
    Id: number;
    SourceId: number;
    sourceTitle?: string | null;
    sourceType?: string | null;
    sourceRepo?: string | null;
    Page?: string | null;
    Quay?: string | null;
    DataText?: string | null;
    Url?: string | null;
}

interface AttachSourceSidebarProps {
    factTable: string;
    /** Pass `null` in new-entity flows where the row hasn't been persisted yet. */
    factId: number | null;
    factLabel: string;
    personName?: string;
    onClose: () => void;
    /** Called after a citation is successfully POSTed. Used in edit flows to refetch. */
    onAttached?: () => void;
    /** When provided, the sidebar queues the citation locally instead of POSTing. Used in new-entity flows. */
    onPending?: (pending: PendingCitation) => void;
    /** Citations already attached to this fact — seeds the Attached list before the self-fetch resolves. */
    existingCitations?: ExistingCitation[];
    /** Initial workspace state for direct add/edit entry points. */
    initialView?: SidebarView;
    initialCitationId?: number | null;
    /** Citation removal requires owner/edit; contributors may still add and edit evidence. */
    canDetach?: boolean;
    /** The person and fact behind the Search records tab (#1028); without it the tab is hidden. */
    research?: ResearchSubject | null;
    /** False for a viewer, who gets only the Search records tab, without its outcome buttons. */
    canCite?: boolean;
    /**
     * Citations to copy, listed first under Add source (#34): picking one selects its
     * source and prefills the detail, certainty, transcription and link, all still
     * editable. Saving writes a new citation as usual.
     */
    citationPicks?: CitationPickGroup[];
}

const SOURCE_TYPES = ['Census', 'Vital', 'Church', 'Newspaper', 'Oral', 'Document', 'Photo', 'Other'];
const TYPE_FILTERS = ['All', ...SOURCE_TYPES];

type SidebarView = 'attached' | 'add' | 'editor' | 'search';

export default function AttachSourceSidebar({
    factTable, factId, factLabel, personName, onClose, onAttached, onPending, existingCitations,
    initialView, initialCitationId, canDetach = true, research = null, canCite = true, citationPicks,
}: AttachSourceSidebarProps) {
    const t = useTranslations('library');
    const tr = useTranslations('research');
    const sourceTypeLabel = (type: string) => t(`type_${type}`);
    const { activeTreeId } = useTree();
    const isMobile = useIsMobile();
    const tc = useTranslations('common');
    const { redirectIfUnauthorized } = useErrorToast();
    const isPending = onPending != null;
    const [error, setError] = useState<string | null>(null);
    const trapRef = useFocusTrap<HTMLDivElement>();
    // Field ids, so each visible label names its control (#800, EV-8).
    const fieldId = useId();

    // View state machine. Pending (new-entity) flows have no persisted citations to
    // list/edit, so they open straight on Add-source and never show Attached/Editor.
    // A viewer can only search, so the sidebar opens on (and stays on) Search records.
    const [view, setView] = useState<SidebarView>(
        !canCite ? 'search' : isPending ? 'add' : initialCitationId ? 'editor' : (initialView === 'search' && !research ? 'attached' : (initialView ?? 'attached')),
    );
    const [addMode, setAddMode] = useState<'pick' | 'create'>('pick');
    const [editingId, setEditingId] = useState<number | null>(initialCitationId ?? null);
    const [citations, setCitations] = useState<ExistingCitation[]>(existingCitations ?? []);

    const [q, setQ] = useState('');
    const [typeFilter, setTypeFilter] = useState('All');
    const [sources, setSources] = useState<Source[]>([]);
    // The tree's most recently cited sources, listed first until a search (#799).
    const [recentSources, setRecentSources] = useState<Source[]>([]);
    const [selected, setSelected] = useState<Source | null>(null);
    // The quick pick the form was prefilled from, if any (#34).
    const [pickedKey, setPickedKey] = useState<string | null>(null);
    const [page, setPage] = useState('');
    const [quay, setQuay] = useState('');
    const [dataText, setDataText] = useState('');
    const [url, setUrl] = useState('');
    const [attaching, setAttaching] = useState(false);
    const [visible, setVisible] = useState(false);

    // Create-new form state (full set of source fields per design doc §6.6)
    const [newSource, setNewSource] = useState<SourceFormState>(emptySourceForm);
    const [creating, setCreating] = useState(false);
    // "Found it, cite it" (#1029): the site the new source is being cited from, and the sites already cited.
    const [citeSite, setCiteSite] = useState<{ site: SiteDefinition; kind: FactKind } | null>(null);
    const [cited, setCited] = useState<ReadonlySet<string>>(() => new Set());

    // Editor state (edit an already-attached citation in place)
    const [editPage, setEditPage] = useState('');
    const [editQuay, setEditQuay] = useState('');
    const [editDataText, setEditDataText] = useState('');
    const [editUrl, setEditUrl] = useState('');
    const [savingEdit, setSavingEdit] = useState(false);
    const initialCitationHydrated = useRef<number | null>(null);

    function showMutationError(errorValue: unknown, fallback: string) {
        if (redirectIfUnauthorized(errorValue)) return;
        const key = errorToastKey(errorValue);
        setError(key === 'error_generic' ? fallback : tc(key));
    }

    useEffect(() => {
        requestAnimationFrame(() => setVisible(true));
    }, []);

    const refreshCitations = useCallback(async () => {
        if (isPending || factId == null) return;
        try {
            const client = await getDataClient();
            const rows = await client.citations.listForFact(factTable as FactTableValue, factId, activeTreeId);
            setCitations(rows.map(r => ({
                Id: r.Id, SourceId: r.SourceId, sourceTitle: r.sourceTitle, sourceType: r.sourceType,
                sourceRepo: r.sourceRepo, Page: r.Page, Quay: r.Quay, DataText: r.DataText, Url: r.Url,
            })));
        } catch (e) {
            console.error('Failed to load citations', e);
        }
    }, [isPending, factId, factTable, activeTreeId]);

    useEffect(() => { refreshCitations(); }, [refreshCitations]);

    // Preview-to-editor entry starts with only the citation id. Hydrate the
    // editor once the matching citation is available, whether it was seeded
    // in existingCitations or arrived through the async refresh. The ref keeps
    // a refresh from overwriting edits the user has already started making.
    useEffect(() => {
        if (initialCitationId == null || editingId !== initialCitationId) return;
        if (initialCitationHydrated.current === initialCitationId) return;
        const citation = citations.find(c => c.Id === initialCitationId);
        if (!citation) return;

        setEditPage(citation.Page ?? '');
        setEditQuay(citation.Quay ?? '');
        setEditDataText(citation.DataText ?? '');
        setEditUrl(citation.Url ?? '');
        initialCitationHydrated.current = initialCitationId;
    }, [citations, editingId, initialCitationId]);

    const fetchSources = useCallback(async () => {
        try {
            const client = await getDataClient();
            if (q) {
                setSources(await client.sources.search(q, activeTreeId));
            } else {
                // The recent group is a shortcut: failing it mustn't empty the list.
                const [{ sources }, recent] = await Promise.all([
                    client.sources.list({ treeId: activeTreeId }),
                    client.sources.listRecentlyCited(activeTreeId).catch(() => [] as Source[]),
                ]);
                setSources(sources);
                setRecentSources(recent);
            }
        } catch (err) {
            console.error('Failed to load sources', err);
        }
    }, [q, activeTreeId]);

    useEffect(() => {
        const timer = setTimeout(fetchSources, 200);
        return () => clearTimeout(timer);
    }, [fetchSources]);

    const byType = (list: Source[]) => typeFilter === 'All' ? list : list.filter(s => s.Type === typeFilter);
    const recent = q ? [] : byType(recentSources);
    const recentIds = new Set(recent.map(s => s.Id));
    const filtered = byType(sources).filter(s => !recentIds.has(s.Id));

    function resetAddForm() {
        setSelected(null); setPickedKey(null); setPage(''); setQuay(''); setDataText(''); setUrl('');
        setNewSource(emptySourceForm);
    }

    // Found it, cite it: Add source › Create new, prefilled with only what the
    // site settles, and the site's repository as the picker's Automatic choice.
    function startCite(site: SiteDefinition, kind: FactKind) {
        resetAddForm();
        setCiteSite({ site, kind });
        setNewSource({
            ...emptySourceForm,
            Title: site.prefill?.title?.[kind] ?? '',
            Type: prefillType(site, kind) ?? emptySourceForm.Type,
            RepositoryName: site.repository.name,
        });
        setError(null);
        setAddMode('create');
        setView('add');
    }

    function leaveCite() {
        setCiteSite(null);
        resetAddForm();
    }

    // A citation is saved. From a site search, go back to the search with that
    // site marked Cited; otherwise this was a one-shot action, so close.
    function afterAttach() {
        resetAddForm();
        if (citeSite) {
            setCited(prev => new Set(prev).add(citeSite.site.id));
            setCiteSite(null);
            setView('search');
        } else {
            handleClose();
        }
    }

    async function handleAttach() {
        if (!selected) return;
        setAttaching(true);
        setError(null);
        try {
            if (isPending) {
                onPending!({
                    factTable,
                    factLabel,
                    page: page || null,
                    quay: quay || null,
                    dataText: dataText || null,
                    url: url || null,
                    sourceId: selected.Id,
                    sourceTitle: selected.Title,
                });
                handleClose();
                return;
            }
            if (factId == null) return;
            const client = await getDataClient();
            await client.citations.create({ FactTable: factTable as FactTableValue, FactId: factId, SourceId: selected.Id, Page: page || null, Quay: quay || null, DataText: dataText || null, Url: url || null }, activeTreeId);
            onAttached?.();
            await refreshCitations();
            // Adding evidence from an empty cite tag is a one-shot action. The
            // caller owns the tag and should close this workspace once the link
            // has been persisted, rather than leaving the user on Attached.
            afterAttach();
        } catch (e) {
            showMutationError(e, t('attach_failed'));
        } finally {
            setAttaching(false);
        }
    }

    async function handleCreate() {
        if (!newSource.Title.trim()) return;
        setCreating(true);
        setError(null);
        const sourcePayload = {
            Title: newSource.Title.trim(),
            Type: newSource.Type,
            Author: newSource.Author || null,
            RepositoryName: newSource.RepositoryName || null,
            CallNumber: newSource.CallNumber || null,
            Text: newSource.Text || null,
            PublicationInfo: newSource.PublicationInfo || null,
            Contents: newSource.Contents || null,
        };
        try {
            if (isPending) {
                onPending!({
                    factTable,
                    factLabel,
                    page: page || null,
                    quay: quay || null,
                    dataText: dataText || null,
                    url: url || null,
                    newSource: sourcePayload,
                });
                handleClose();
                return;
            }
            if (factId == null) return;
            let created;
            try {
                const client = await getDataClient();
                created = await client.sources.create(sourcePayload, activeTreeId);
            } catch (e) {
                showMutationError(e, t('create_failed'));
                return; // source creation failed → stop, sidebar stays open (finally resets creating)
            }
            try {
                const client = await getDataClient();
                await client.citations.create({ FactTable: factTable as FactTableValue, FactId: factId, SourceId: created.Id, Page: page || null, Quay: quay || null, DataText: dataText || null, Url: url || null }, activeTreeId);
                onAttached?.();
                await refreshCitations();
                afterAttach();
            } catch (e) {
                // INTENTIONAL: source created but link failed → inform, refresh, leave open (orphan warned)
                showMutationError(e, t('attach_failed_after_create'));
                onAttached?.();
                return;
            }
        } finally {
            setCreating(false);
        }
    }

    function openEditor(c: ExistingCitation) {
        setEditingId(c.Id);
        setEditPage(c.Page ?? '');
        setEditQuay(c.Quay ?? '');
        setEditDataText(c.DataText ?? '');
        setEditUrl(c.Url ?? '');
        setError(null);
        setView('editor');
    }

    async function handleSaveEdit() {
        if (editingId == null) return;
        setSavingEdit(true);
        setError(null);
        try {
            const client = await getDataClient();
            await client.citations.update(editingId, { Page: editPage || null, Quay: editQuay || null, DataText: editDataText || null, Url: editUrl || null }, activeTreeId);
            onAttached?.();
            await refreshCitations();
            setEditingId(null);
            // Editing from a citation preview is also a one-shot flow. Closing
            // here prevents the parent refresh from returning the user to the
            // stale Attached view after the save completes.
            handleClose();
        } catch (e) {
            showMutationError(e, t('attach_failed'));
        } finally {
            setSavingEdit(false);
        }
    }

    async function handleDetach(id: number) {
        setError(null);
        try {
            const client = await getDataClient();
            await client.citations.remove(id, activeTreeId);
            onAttached?.();
            await refreshCitations();
            setEditingId(null);
            setView('attached');
        } catch (e) {
            showMutationError(e, t('remove_failed'));
        }
    }

    const handleClose = useCallback(() => {
        setVisible(false);
        setTimeout(onClose, 280);
    }, [onClose]);

    // Escape closes the sidebar.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') handleClose();
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [handleClose]);

    const attachLabel = isPending ? t('queue_source') : t('attach_title');
    // renderEditor falls back to the list until its citation has loaded; the title follows what shows.
    const isEditing = view === 'editor' && citations.some(c => c.Id === editingId);
    const createLabel = isPending ? t('queue_new_source') : t('create_attach');
    const topTabs: [SidebarView, string, number | undefined][] = [
        ['attached', t('tab_attached'), citations.length],
        ['add', t('tab_add_source'), undefined],
        ...(research ? [['search', tr('tab'), undefined] as [SidebarView, string, undefined]] : []),
    ];

    const labelStyle = { fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block', marginBottom: 4, marginTop: 10 };
    // Certainty (QUAY) + transcription — optional GEDCOM evidence fields shared by both add modes.
    const evidenceFields = (
        <>
            <label htmlFor={`${fieldId}-record-link`} className="muted" style={labelStyle}>{t('field_record_link')}</label>
            <input
                id={`${fieldId}-record-link`}
                type="url"
                inputMode="url"
                autoComplete="off"
                value={url}
                onChange={e => setUrl(e.target.value)}
                className={fieldClass('sm')}
                placeholder={t('ph_record_link')}
            />
            <div id={`${fieldId}-certainty`} className="muted" style={labelStyle}>{t('field_certainty')}</div>
            <CertaintySegments value={quay} onChange={setQuay} idPrefix="add" labelledBy={`${fieldId}-certainty`} />
            <label htmlFor={`${fieldId}-transcription`} className="muted" style={labelStyle}>{t('field_transcription')}</label>
            <textarea
                id={`${fieldId}-transcription`}
                value={dataText}
                onChange={e => setDataText(e.target.value)}
                rows={2}
                className={`${fieldClass('sm')} resize-y`}
                placeholder={t('ph_transcription')}
            />
        </>
    );

    // Certainty chip for the Attached list — colour + text label (colour-blind safe).
    function CertaintyChip({ q }: { q?: string | null }) {
        if (!q || !isQuayValue(q)) return null;
        return (
            <Badge tone={quayTone(q)} className="text-[9px] py-[1px] px-1.5">
                {t(QUAY_LABEL_KEY[q])}
            </Badge>
        );
    }

    // A citation to copy: its source, with the form prefilled from it (#34).
    function choosePick(pick: CitationPick) {
        setSelected({ Id: pick.sourceId, Title: pick.sourceTitle, Type: pick.sourceType, Author: null, RepositoryName: pick.sourceRepo });
        setPickedKey(pick.key);
        setPage(pick.page ?? '');
        setQuay(pick.quay ?? '');
        setDataText(pick.dataText ?? '');
        setUrl(pick.url ?? '');
    }

    function renderPickOption(pick: CitationPick) {
        const detail = [pick.context, pick.page].filter(Boolean).join(' · ');
        return (
            <button
                key={pick.key}
                type="button"
                aria-pressed={pickedKey === pick.key}
                onClick={() => choosePick(pick)}
                className="text-left py-2.5 px-3.5 min-h-11 w-full border-0 border-b border-solid border-border cursor-pointer focus-ring-inset"
                style={{ background: pickedKey === pick.key ? 'var(--surface-2)' : 'transparent' }}
            >
                <div className="flex items-center gap-1.5 mb-0.5">
                    <Badge className="text-xs">{sourceTypeLabel(pick.sourceType ?? 'Document')}</Badge>
                    <span className="font-medium text-sm truncate text-text">{pick.sourceTitle ?? t('untitled_source')}</span>
                </div>
                {detail && <div className="muted text-xs truncate">{detail}</div>}
            </button>
        );
    }

    const pickGroups = !q ? (citationPicks ?? []).filter(g => g.picks.length > 0) : [];

    // One row in the Add-source list (search results, or the recent and all-sources groups).
    function renderSourceOption(s: Source) {
        return (
            <button
                key={s.Id}
                type="button"
                aria-pressed={pickedKey == null && selected?.Id === s.Id}
                onClick={() => { setPickedKey(null); setSelected(s); }}
                className="text-left py-2.5 px-3.5 min-h-11"
                style={{
                    width: '100%',
                    background: pickedKey == null && selected?.Id === s.Id ? 'var(--surface-2)' : 'transparent',
                    border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                }}
            >
                <div className="flex items-center gap-1.5 mb-0.5">
                    <Badge className="text-[10px]">{sourceTypeLabel(s.Type ?? 'Document')}</Badge>
                    <span className="font-medium text-sm truncate" style={{ color: 'var(--text)' }}>
                        {s.Title ?? t('untitled_source')}
                    </span>
                </div>
                {(s.Author || s.RepositoryName) && (
                    <div className="muted text-xs truncate">
                        {[s.Author, s.RepositoryName].filter(Boolean).join(' · ')}
                    </div>
                )}
            </button>
        );
    }

    // ---- Attached view ----
    function renderAttached() {
        if (citations.length === 0) {
            return (
                <div className="flex-1 overflow-auto flex flex-col items-center justify-center text-center py-8 px-4 gap-3">
                    <div className="muted text-sm">{t('no_sources_empty')}</div>
                    <div className="flex flex-wrap justify-center gap-2">
                        <Button variant="primary" onClick={() => setView('add')} className="pointer-coarse:min-h-11 text-meta py-1.5 px-3.5">{t('tab_add_source')}</Button>
                        {research && <Button variant="outline" onClick={() => setView('search')} className="pointer-coarse:min-h-11 text-meta py-1.5 px-3.5">{tr('tab')}</Button>}
                    </div>
                </div>
            );
        }
        return (
            <>
                <div className="flex-1 overflow-auto flex flex-col p-3 gap-2">
                    {citations.map(c => (
                        <div key={c.Id} className="flex flex-col rounded-[10px]" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
                        <button
                            onClick={() => openEditor(c)}
                            className="flex items-center text-left rounded-[10px] py-[11px] px-[13px] gap-2.5 min-h-11"
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', width: '100%' }}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-1">
                                    <Badge className="text-[9px]">{sourceTypeLabel(c.sourceType ?? 'Document')}</Badge>
                                    <span className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>
                                        {c.sourceTitle ?? t('untitled_source')}
                                    </span>
                                </div>
                                <div className="muted text-xs flex items-center gap-1.5">
                                    {c.Page && <span>{c.Page}</span>}
                                    <CertaintyChip q={c.Quay} />
                                </div>
                                {c.DataText && (
                                    <div className="muted serif text-xs italic truncate mt-[3px]">
                                        &ldquo;{c.DataText}&rdquo;
                                    </div>
                                )}
                            </div>
                            <span aria-hidden className="text-md" style={{ color: 'var(--text-muted)' }}>›</span>
                        </button>
                        {/* A sibling of the row button: a link can't sit inside a button. */}
                        {c.Url && <CitationLink url={c.Url} className="mx-[13px] mb-[11px] -mt-1 self-start pointer-coarse:min-h-11" />}
                        </div>
                    ))}
                </div>
                <div className="muted text-xs py-2.5 px-4 shrink-0" style={{ borderTop: '1px solid var(--border)', background: 'var(--card-alt)' }}>
                    {t('count_summary', { count: citations.length })}
                </div>
            </>
        );
    }

    // ---- Editor view ----
    function renderEditor() {
        const c = citations.find(x => x.Id === editingId);
        if (!c) return renderAttached();
        const idx = citations.findIndex(x => x.Id === c.Id) + 1;
        return (
            <>
                <div className="flex items-center py-[13px] px-4 gap-[9px] shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
                    <button onClick={() => { setEditingId(null); setView('attached'); }} className="inline-flex items-center gap-1.5 text-sm font-semibold pointer-coarse:min-h-11" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 0 }}>
                        <span aria-hidden className="text-md">‹</span>{t('all_sources')}
                    </button>
                    <span className="muted text-meta">· {t('source_of', { index: idx, total: citations.length })}</span>
                </div>
                <div className="flex-1 overflow-auto p-4">
                    <div className="rounded-[12px] py-[13px] px-3.5 mb-[18px]" style={{ border: '1px solid var(--border)', background: 'var(--card-alt)' }}>
                        <div className="mb-[7px]">
                            <Badge className="text-[10px]">{sourceTypeLabel(c.sourceType ?? 'Document')}</Badge>
                        </div>
                        <div className="serif text-md font-semibold mb-1" style={{ lineHeight: 1.2 }}>{c.sourceTitle ?? t('untitled_source')}</div>
                        <div className="muted text-meta mb-2.5">{c.sourceRepo || t('no_repository')}</div>
                        <a href={librarySourceHref(c.SourceId)} className="text-meta pointer-coarse:inline-flex pointer-coarse:items-center pointer-coarse:min-h-11">
                            {t('open_in_library')}
                        </a>
                    </div>
                    <label htmlFor={`${fieldId}-edit-page`} className="muted" style={{ ...labelStyle, marginTop: 0 }}>{t('citation_detail')}</label>
                    <input
                        id={`${fieldId}-edit-page`}
                        type="text"
                        value={editPage}
                        onChange={e => setEditPage(e.target.value)}
                        className={fieldClass('sm')}
                        placeholder={t('ph_page_optional')}
                    />
                    <label htmlFor={`${fieldId}-edit-record-link`} className="muted" style={labelStyle}>{t('field_record_link')}</label>
                    <input
                        id={`${fieldId}-edit-record-link`}
                        type="url"
                        inputMode="url"
                        autoComplete="off"
                        value={editUrl}
                        onChange={e => setEditUrl(e.target.value)}
                        className={fieldClass('sm')}
                        placeholder={t('ph_record_link')}
                    />
                    <div id={`${fieldId}-edit-certainty`} className="muted" style={labelStyle}>{t('field_certainty')}</div>
                    <CertaintySegments value={editQuay} onChange={setEditQuay} idPrefix="edit" labelledBy={`${fieldId}-edit-certainty`} />
                    <label htmlFor={`${fieldId}-edit-transcription`} className="muted" style={labelStyle}>{t('field_transcription')}</label>
                    <textarea
                        id={`${fieldId}-edit-transcription`}
                        value={editDataText}
                        onChange={e => setEditDataText(e.target.value)}
                        rows={4}
                        className={`${fieldClass('sm')} resize-y`}
                        placeholder={t('ph_transcription')}
                    />
                </div>
                <div className="flex items-center justify-between py-3 px-4 shrink-0" style={{ borderTop: '1px solid var(--border)', background: 'var(--card-alt)' }}>
                    {canDetach ? (
                        <Button
                            variant="outline"
                            onClick={() => handleDetach(c.Id)}
                            className="pointer-coarse:min-h-11 text-meta py-[5px] px-[11px] border-error/40"
                            style={{ color: 'var(--color-error)' }}
                            title={t('detach')}
                        >
                            {t('detach')}
                        </Button>
                    ) : <span />}
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => { setEditingId(null); setView('attached'); }} className="pointer-coarse:min-h-11 text-meta py-[5px] px-3">{t('cancel')}</Button>
                        <Button variant="primary" onClick={handleSaveEdit} disabled={savingEdit} className="pointer-coarse:min-h-11 text-meta py-[5px] px-3">
                            {savingEdit ? t('saving') : t('save')}
                        </Button>
                    </div>
                </div>
            </>
        );
    }

    // ---- Add-source view (Pick / Create sub-tabs) ----
    function renderAdd() {
        return (
            <>
                {citeSite && (
                    <div className="flex items-center py-2.5 px-4 gap-[9px] shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
                        <button onClick={() => { leaveCite(); setView('search'); }} className="inline-flex items-center gap-1.5 text-sm font-semibold pointer-coarse:min-h-11" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 0 }}>
                            <span aria-hidden className="text-md">‹</span>{tr('back_to_search')}
                        </button>
                        <span className="muted text-meta min-w-0 truncate">· {tr('cite_from', { site: citeSite.site.name })}</span>
                    </div>
                )}
                <div className="flex gap-[18px] py-0 px-4 shrink-0" style={{ background: 'var(--card-alt)', borderBottom: '1px solid var(--border)' }}>
                    {(['pick', 'create'] as const).map(m => (
                        <button
                            key={m}
                            onClick={() => setAddMode(m)}
                            className={`pt-2 px-0.5 pb-[7px] text-meta mb-[-1px] pointer-coarse:min-h-11 ${addMode === m ? 'font-semibold' : 'font-medium'}`}
                            style={{
                                background: 'none', border: 'none', borderBottom: addMode === m ? '2px solid var(--text)' : '2px solid transparent',
                                cursor: 'pointer', color: addMode === m ? 'var(--text)' : 'var(--text-muted)',
                            }}
                        >
                            {m === 'pick' ? t('subtab_pick') : t('subtab_create')}
                        </button>
                    ))}
                </div>
                {addMode === 'pick' ? (
                    <>
                        <div className="py-2.5 px-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
                            <input
                                type="text"
                                placeholder={t('search_sources_short')}
                                value={q}
                                onChange={e => setQ(e.target.value)}
                                className={`${fieldClass('sm')} mb-2`}
                            />
                            <div className="flex flex-wrap gap-1">
                                {TYPE_FILTERS.map(f => (
                                    <button
                                        key={f}
                                        onClick={() => setTypeFilter(f)}
                                        className={cx(
                                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10px] font-medium whitespace-nowrap cursor-pointer pointer-coarse:min-h-11 pointer-coarse:px-3 pointer-coarse:text-sm',
                                            typeFilter === f
                                                ? 'bg-info-bg text-info-text'
                                                : 'bg-transparent border border-border text-text-secondary',
                                        )}
                                    >
                                        {f === 'All' ? t('filter_all_types') : sourceTypeLabel(f)}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto">
                            {pickGroups.map(g => (
                                <div key={g.id} role="group" aria-labelledby={`attach-pick-${g.id}`}>
                                    <div id={`attach-pick-${g.id}`} className="eyebrow pt-2.5 pb-1 px-3.5">{g.label}</div>
                                    {g.picks.map(renderPickOption)}
                                </div>
                            ))}
                            {recent.length === 0 && filtered.length === 0 ? (
                                <div className="muted py-6 px-4 text-center text-sm">
                                    {t('no_sources_found')}
                                </div>
                            ) : (
                                <>
                                    {recent.length > 0 && (
                                        <div role="group" aria-labelledby="attach-recent-heading">
                                            <div id="attach-recent-heading" className="eyebrow pt-2.5 pb-1 px-3.5">{t('recently_cited')}</div>
                                            {recent.map(renderSourceOption)}
                                        </div>
                                    )}
                                    {filtered.length > 0 && (
                                        <div role={recent.length > 0 ? 'group' : undefined} aria-labelledby={recent.length > 0 ? 'attach-all-heading' : undefined}>
                                            {recent.length > 0 && (
                                                <div id="attach-all-heading" className="eyebrow pt-3 pb-1 px-3.5">{t('all_sources')}</div>
                                            )}
                                            {filtered.map(renderSourceOption)}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                        {selected && (
                            <div className="py-3 px-3.5 shrink-0" style={{ borderTop: '1px solid var(--border)', background: 'var(--card-alt)' }}>
                                <div className="muted uppercase text-[10px] tracking-[0.06em] font-semibold mb-[9px]">
                                    {t('new_citation_for', { title: selected.Title ?? t('untitled_source') })}
                                </div>
                                <label htmlFor={`${fieldId}-page`} className="muted" style={{ ...labelStyle, marginTop: 0 }}>{t('citation_detail')}</label>
                                <input
                                    id={`${fieldId}-page`}
                                    type="text"
                                    placeholder={t('ph_page_optional')}
                                    value={page}
                                    onChange={e => setPage(e.target.value)}
                                    className={fieldClass('sm')}
                                />
                                {evidenceFields}
                                <div className="flex justify-end gap-1.5 mt-3">
                                    <Button variant="outline" onClick={handleClose} className="pointer-coarse:min-h-11 text-meta py-[5px] px-3">{t('cancel')}</Button>
                                    <Button variant="primary" onClick={handleAttach} disabled={attaching} className="pointer-coarse:min-h-11 text-meta py-[5px] px-3">
                                        {attaching ? t('attaching') : attachLabel}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex-1 overflow-auto flex flex-col p-4 gap-3">
                        <SourceFields
                            value={newSource}
                            onChange={patch => setNewSource(prev => ({ ...prev, ...patch }))}
                            idPrefix="attach-create"
                            treeId={activeTreeId}
                            compact
                            automaticRepository={citeSite?.site.repository.name}
                        />
                        <div>
                            <label htmlFor={`${fieldId}-page`} className="muted uppercase block text-[10px] tracking-[0.06em] mb-1">{t('citation_detail')}</label>
                            <input id={`${fieldId}-page`} type="text" value={page} onChange={e => setPage(e.target.value)} className={fieldClass('sm')} placeholder={t('ph_page_optional')} />
                            {evidenceFields}
                        </div>
                        <div className="flex justify-end gap-1.5 mt-1">
                            <Button variant="outline" onClick={handleClose} className="pointer-coarse:min-h-11 text-meta py-[5px] px-3">{t('cancel')}</Button>
                            <Button variant="primary" onClick={handleCreate} disabled={creating || !newSource.Title.trim()} className="pointer-coarse:min-h-11 text-meta py-[5px] px-3">
                                {creating ? t('creating') : createLabel}
                            </Button>
                        </div>
                    </div>
                )}
            </>
        );
    }

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={handleClose}
                className="bg-[rgba(0,0,0,0.35)]"
                style={{
                    position: 'fixed', inset: 0, zIndex: 49,
                    opacity: visible ? 1 : 0, transition: 'opacity 0.25s',
                }}
            />

            {/* Sidebar */}
            <div
                ref={trapRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby="attach-source-title"
                className="flex flex-col shadow-[-4px_0_24px_rgba(0,0,0,0.14)] outline-none"
                style={{
                    position: 'fixed', top: 0, right: 0, bottom: 0, left: isMobile ? 0 : 'auto',
                    width: isMobile ? '100%' : 384, maxWidth: '100vw',
                    background: 'var(--card)',
                    zIndex: 50,
                    transform: visible ? 'translateX(0)' : 'translateX(100%)',
                    transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
                }}
            >
                {/* Header */}
                <div className="pt-4 px-4 pb-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="flex justify-between items-start mb-1">
                        <div id="attach-source-title" className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>{isEditing ? t('edit_citation') : canCite ? t('attach_title') : tr('tab')}</div>
                        <button onClick={handleClose} aria-label={t('cancel')} title={t('cancel')} className="text-lg py-0 px-0.5 pointer-coarse:grid pointer-coarse:place-items-center pointer-coarse:w-11 pointer-coarse:h-11 pointer-coarse:-my-3 pointer-coarse:-mr-3" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
                    </div>
                    <div className="muted text-meta">
                        {personName && <><strong style={{ color: 'var(--text)' }}>{personName}</strong> · </>}
                        <em>{factLabel}</em>
                    </div>
                </div>

                {/* Inline error banner */}
                {error && (
                    <div
                        role="alert"
                        className="text-sm py-2.5 px-4 shrink-0"
                        style={{ background: 'var(--color-error-bg, #fee2e2)', color: 'var(--color-error, #b91c1c)', borderBottom: '1px solid var(--border)' }}
                    >
                        {error}
                    </div>
                )}

                {/* Top tabs — hidden in the editor, in pending (new-entity) mode and for a viewer */}
                {!isPending && canCite && view !== 'editor' && (
                    <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--card-alt)' }}>
                        {topTabs.map(([id, label, count]) => (
                            <button
                                key={id}
                                onClick={() => { if (citeSite) leaveCite(); setView(id); }}
                                className={`flex-1 pt-[11px] px-2 pb-2.5 text-sm min-h-11 ${view === id ? 'font-semibold' : 'font-medium'}`}
                                style={{
                                    background: 'transparent', border: 'none', cursor: 'pointer',
                                    borderBottom: view === id ? '2px solid var(--text)' : '2px solid transparent',
                                    color: view === id ? 'var(--text)' : 'var(--text-muted)',
                                }}
                            >
                                {label}{count !== undefined && <span className="muted font-normal"> ({count})</span>}
                            </button>
                        ))}
                    </div>
                )}

                {/* Body */}
                <div className="flex-1 min-h-0 flex flex-col">
                    {view === 'editor' ? renderEditor() : view === 'attached' ? renderAttached() : view === 'add' ? renderAdd() : null}
                    {/* Kept mounted, so edited details and opened sites survive a trip to another tab. */}
                    {research && (
                        <div hidden={view !== 'search'} className="flex-1 min-h-0 overflow-auto">
                            <SearchRecordsPanel
                                subject={research}
                                canCite={canCite && !isPending}
                                cited={cited}
                                onFound={startCite}
                            />
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
