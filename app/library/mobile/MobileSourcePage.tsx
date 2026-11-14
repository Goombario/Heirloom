'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CitationFileField, CitationFileLine } from '@/app/components/citations/CitationFileField';
import { getDataClient } from '@/lib/data';
import type { Note } from '@/lib/data/types';
import type { CitedByRow } from '@/lib/db/queries/citations';
import { EVENT_TYPES, getEventDisplayType } from '@/lib/db/schema';
import { QUAY_LABEL_KEY, QUAY_VALUES, isQuayValue } from '@/lib/citations/quay';
import { citedByLabel } from '@/lib/library/cited-by-label';
import { formatDateForDisplay } from '@/lib/date-utils';
import { PROVES_GROUP_FROM, groupProvesRows } from '@/lib/library/proves-groups';
import { useTree } from '@/app/contexts/TreeContext';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { familyEventLabel } from '@/app/components/familyEventTypes';
import PersonAvatar from '@/app/components/PersonAvatar';
import RecordNotFound from '@/app/components/RecordNotFound';
import { Skeleton } from '@/app/components/SkeletonLoader';
import { MobileNoteSheet } from '@/app/components/notes/MobileNoteSheet';
import { MobileOwnerMedia } from '@/app/components/media/MobileOwnerMedia';
import { QuietRow, RecordBand } from '@/app/components/mobile/RecordBand';
import { AvatarStack, InlineDataError, MobileListChip, MobileRow, PageShell, cx } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { useChange } from '@/app/people/view/mobile/useChange';
import { Head, HeadLink, Section } from '@/app/people/view/mobile/panes';
import { ChevronRight, FolderSearch, Plus, Trash2 } from '@/lib/icons';
import { initialsFromName } from '@/lib/utils/initials';
import { SourceTypeIcon, sourceTypeLabel } from '../sourceTypes';
import { useSourceEditor } from '../useSourceEditor';
import { repositoryHref } from '../MobileLibrary';
import { SourceFormSheet } from './SourceFormSheet';
import { CiteOnSheets } from './CiteOnSheets';
import { LIBRARY_SOURCES_HREF } from '@/app/library/links';

/*
 * The source page on phones (#1119, v6). A page, not a modal: the dark band with Back
 * and the pencil, type as the eyebrow, the serif title, then repository and call
 * number. Details as quiet rows, the source's text clipped with Read all, then What
 * it proves on the desktop rule (#1181), Used in research, Media and Notes. Cite on is
 * the two-step picker. The pencil opens the source sheet, whose last row deletes.
 */

export function MobileSourcePage({ sourceId }: { sourceId: number }) {
    const t = useTranslations('mobileLibrary');
    const tl = useTranslations('library');
    const tn = useTranslations('notes');
    const tm = useTranslations('ownerMedia');
    const tc = useTranslations('common');
    const router = useRouter();
    const { activeTreeId, activePermission } = useTree();
    const editor = activePermission !== 'view';
    const canDelete = activePermission === 'owner' || activePermission === 'edit';
    const { source, citedBy, loading, loadError, notFound, reload } = useSourceEditor(sourceId, activeTreeId);
    const [sheet, setSheet] = useState<'edit' | 'cite' | null>(null);
    const [citation, setCitation] = useState<CitedByRow | null>(null);
    const [readAll, setReadAll] = useState(false);
    const [mediaCount, setMediaCount] = useState(0);
    const [notes, setNotes] = useState<Note[]>([]);
    const [noteFlow, setNoteFlow] = useState<{ note: Note | null } | null>(null);
    const [lastNote, setLastNote] = useState<{ note: Note | null }>({ note: null });
    if (noteFlow && noteFlow !== lastNote) setLastNote(noteFlow);

    const loadNotes = useCallback(async () => {
        try {
            const client = await getDataClient();
            setNotes(await client.notes.listForOwner('Sources', sourceId, activeTreeId));
        } catch { /* the section stays empty */ }
    }, [sourceId, activeTreeId]);
    // The list arrives after an await; the rule can't see past the call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { void loadNotes(); }, [loadNotes]);
    const onChanged = useCallback(async () => { reload(); await loadNotes(); }, [reload, loadNotes]);
    const run = useChange({ treeId: activeTreeId, canUndo: canDelete, onChanged });

    // A case, or a journal entry in one, uses the source; neither is a fact it proves.
    const research = citedBy.filter((r) => r.factTable === 'Cases' || r.factTable === 'CaseComments');
    const facts = citedBy.filter((r) => !research.includes(r));
    const cases = research.filter((r, i) => research.findIndex((x) => x.caseId === r.caseId) === i);
    const factCount = citedBy.length - research.length;

    if (notFound) return <RecordNotFound record="source" />;
    if (!source) {
        return (
            <PageShell variant="detail" busy={loading} topBar={(
                <div className="mp-root md:hidden">
                    <div className="hero-dark mp-slim-bar !rounded-none !p-0 !shadow-none h-[190px]" />
                    {loadError
                        ? <div className="px-4 pt-4"><InlineDataError message={tl('failed_load_source')} retryLabel={tc('retry')} onRetry={reload} /></div>
                        : <div className="grid gap-3 p-4"><Skeleton className="h-4 w-[60%]" /><Skeleton className="h-4 w-[80%]" /><Skeleton className="h-4 w-[45%]" /></div>}
                </div>
            )} contentClassName="hidden" />
        );
    }

    const title = source.Title?.trim() || tl('untitled_source');
    const line = [source.RepositoryName, source.CallNumber && <span key="c" className="font-mono text-xs text-[color:var(--color-date)]">{source.CallNumber}</span>]
        .filter(Boolean).map((x, i) => <React.Fragment key={i}>{i > 0 && ' · '}{x}</React.Fragment>);

    return (
        <PageShell variant="detail" contentClassName="hidden" topBar={(
            <div className="mp-root md:hidden overflow-x-clip" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}>
                <RecordBand
                    eyebrow={<><SourceTypeIcon sourceType={source.Type} aria-hidden="true" />{sourceTypeLabel(source.Type, tl)}</>}
                    title={title}
                    line={line.length ? line : undefined}
                    onEdit={editor ? () => setSheet('edit') : undefined}
                    editLabel={t('edit_source')}
                />

                <Section first>
                    <Head title={t('details')} />
                    <QuietRow label={tl('field_type')} divided={false}>{sourceTypeLabel(source.Type, tl)}</QuietRow>
                    {source.Author && <QuietRow label={tl('field_author')}>{source.Author}</QuietRow>}
                    {source.RepositoryName && (
                        <QuietRow label={tl('field_repository')} href={source.RepositoryId != null ? repositoryHref(source.RepositoryId) : undefined}>{source.RepositoryName}</QuietRow>
                    )}
                    {source.CallNumber && <QuietRow label={t('call_no')} mono>{source.CallNumber}</QuietRow>}
                    {source.PublicationInfo && <QuietRow label={t('published')}>{source.PublicationInfo}</QuietRow>}
                    {source.Abbreviation && <QuietRow label={tl('field_abbreviation')}>{source.Abbreviation}</QuietRow>}
                    {source.Text && <QuietRow label={tl('field_url')} href={source.Text}>{source.Text}</QuietRow>}
                </Section>

                {source.Contents && (
                    <Section>
                        <Head title={tl('field_contents_label')} />
                        <p className={cx('m-0 px-4 text-base leading-relaxed text-text-secondary whitespace-pre-wrap', !readAll && 'max-h-[7.9em] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_60%,transparent)]')}>
                            {source.Contents}
                        </p>
                        <div className="px-4">
                            <button type="button" onClick={() => setReadAll((v) => !v)} aria-expanded={readAll}
                                className="min-h-11 text-sm font-medium text-text cursor-pointer rounded focus-ring">
                                {readAll ? t('show_less') : t('read_all')}
                            </button>
                        </div>
                    </Section>
                )}

                <Section>
                    <Head title={t('what_it_proves')} count={factCount}
                        action={editor ? <HeadLink label={t('cite_on')} icon={<ChevronRight />} onClick={() => setSheet('cite')} /> : undefined} />
                    {factCount === 0 && <p className="m-0 px-4 pb-2.5 pt-1 text-sm leading-normal text-text-muted">{editor ? t('proves_none_edit') : t('proves_none')}</p>}
                    {factCount > 0 && <ProvesList rows={facts} treeId={activeTreeId} onOpen={editor ? setCitation : undefined} />}
                </Section>

                {cases.length > 0 && (
                    <Section>
                        <Head title={t('used_in_research')} count={cases.length} />
                        {cases.map((r, i) => (
                            <MobileRow key={r.citationId} href={r.caseId != null ? `/cases/view?id=${r.caseId}` : undefined} end="leave" divided={i > 0}
                                lead={<span aria-hidden="true" className="grid place-items-center w-9 h-9 shrink-0 rounded-[10px] bg-surface-2 text-text-secondary [&_svg]:w-[18px] [&_svg]:h-[18px]"><FolderSearch /></span>}
                                label={<span className="serif font-semibold text-md">{r.caseTitle ?? '?'}</span>} />
                        ))}
                    </Section>
                )}

                {(editor || mediaCount > 0) && (
                    <Section>
                        <Head title={tm('section_title')} count={mediaCount} />
                        <MobileOwnerMedia ownerTable="Sources" ownerId={source.Id} treeId={activeTreeId} canEdit={editor} canDelete={canDelete} onCount={setMediaCount} />
                    </Section>
                )}

                {(editor || notes.length > 0) && (
                    <Section>
                        <Head title={tn('section_title')} count={notes.length} />
                        {notes.map((n, i) => (
                            editor ? (
                                <button key={n.Id} type="button" onClick={() => setNoteFlow({ note: n })}
                                    className={cx('block w-full px-4 py-3 text-left text-base leading-normal text-text-secondary whitespace-pre-line cursor-pointer active:bg-surface-2 focus-ring-inset', i > 0 && 'border-t border-border')}>
                                    {n.Text}
                                </button>
                            ) : (
                                <p key={n.Id} className={cx('m-0 px-4 py-3 text-base leading-normal text-text-secondary whitespace-pre-line', i > 0 && 'border-t border-border')}>{n.Text}</p>
                            )
                        ))}
                        {editor && <MobileRow icon={<Plus />} end="chevron" divided={notes.length > 0} label={tn('add_button')} onClick={() => setNoteFlow({ note: null })} />}
                    </Section>
                )}

                <SourceFormSheet open={sheet === 'edit'} source={source} onClose={() => setSheet(null)} canDelete={canDelete}
                    citationCount={factCount}
                    onSaved={() => { setSheet(null); reload(); }}
                    onDeleted={() => { setSheet(null); router.replace(LIBRARY_SOURCES_HREF); }} />
                <CiteOnSheets open={sheet === 'cite'} source={source} citedBy={citedBy} onClose={() => setSheet(null)}
                    onCited={() => { setSheet(null); reload(); }} />
                <CitationSheet row={citation} onClose={() => setCitation(null)} canDelete={canDelete} run={run} onFilesChanged={reload} />
                <MobileNoteSheet open={noteFlow != null} note={(noteFlow ?? lastNote).note} onClose={() => setNoteFlow(null)}
                    ownerTable="Sources" ownerId={source.Id} treeId={activeTreeId} canDelete={canDelete} run={run} />
            </div>
        )} />
    );
}

/**
 * What this source proves, on the desktop rule (#911, #1181): the query's date-then-person
 * order, one flat list below PROVES_GROUP_FROM, else fact-type groups in label order,
 * collapsed to their counts, with Expand all.
 */
function ProvesList({ rows, treeId, onOpen }: { rows: CitedByRow[]; treeId: number | null; onOpen?: (row: CitedByRow) => void }) {
    const tl = useTranslations('library');
    const { language } = useLanguage();
    const labelOf = useFactLabel();
    const baseId = React.useId();
    const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
    const opener = (r: CitedByRow) => (onOpen ? () => onOpen(r) : undefined);

    if (rows.length < PROVES_GROUP_FROM) {
        return rows.map((r, i) => <FactRow key={r.citationId} row={r} label={labelOf(r)} divided={i > 0} treeId={treeId} onOpen={opener(r)} />);
    }

    const groups = groupProvesRows(rows, labelOf, language);
    const allOpen = groups.every(([label]) => open.has(label));
    const toggle = (label: string) => setOpen((cur) => {
        const next = new Set(cur);
        if (next.has(label)) next.delete(label); else next.add(label);
        return next;
    });
    return (
        <>
            <div className="flex justify-end px-2">
                <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map(([label]) => label)))}
                    className="min-h-11 px-2 text-sm font-medium text-text-secondary cursor-pointer rounded focus-ring">
                    {allOpen ? tl('collapse_all') : tl('expand_all')}
                </button>
            </div>
            {groups.map(([label, items], gi) => {
                const expanded = open.has(label);
                const regionId = `${baseId}-group-${gi}`;
                return (
                    <div key={label} className={cx(gi > 0 && 'border-t border-border')}>
                        <button type="button" aria-expanded={expanded} aria-controls={regionId} onClick={() => toggle(label)}
                            className="flex w-full items-center gap-2 min-h-12 px-4 py-2 text-left cursor-pointer active:bg-surface-2 focus-ring-inset">
                            <ChevronRight aria-hidden="true" className={cx('w-[15px] h-[15px] shrink-0 text-text-muted transition-transform', expanded && 'rotate-90')} />
                            <span className="text-base font-semibold text-text">{label}</span>
                            <span className="font-mono text-meta text-text-muted">· {items.length}</span>
                        </button>
                        {expanded && (
                            <div id={regionId} className="border-t border-border-light">
                                {items.map((r) => <FactRow key={r.citationId} row={r} label={null} treeId={treeId} onOpen={opener(r)} />)}
                            </div>
                        )}
                    </div>
                );
            })}
        </>
    );
}

/**
 * A cited fact: the avatar, "Fact · Person" (inside a fact-type group, just the person)
 * and the certainty word, then date · place with the page in mono on the right. The page
 * sits on the second line so a long reference never squeezes the name.
 */
function FactRow({ row, label, divided = false, treeId, onOpen }: {
    row: CitedByRow;
    label: string | null;
    divided?: boolean;
    treeId: number | null;
    onOpen?: () => void;
}) {
    const tl = useTranslations('library');
    const tc = useTranslations('common');
    const { language } = useLanguage();
    const words = useDateQualifierWords();
    const parts = citedByLabel(row);
    const name = parts.subject && parts.subject !== '?' ? parts.subject : tc('unknown');
    const date = row.factDate ?? parts.date;
    const family = row.personId == null && row.familyId != null;
    const partners = family
        ? [
              { id: 1, name: row.familyPartner1Name, sex: row.familyPartner1Sex, mediaId: row.familyPartner1MediaId },
              { id: 2, name: row.familyPartner2Name, sex: row.familyPartner2Sex, mediaId: row.familyPartner2MediaId },
          ].filter((p): p is { id: number; name: string; sex: string | null; mediaId: number | null } => !!p.name)
        : [];
    const avatar = partners.length > 0 ? (
        <span aria-hidden="true" className="grid place-items-center w-9 h-9 shrink-0"><AvatarStack people={partners} treeId={treeId} size={26} max={2} /></span>
    ) : family ? (
        <span aria-hidden="true" className="avatar-neutral grid place-items-center w-9 h-9 shrink-0 rounded-full text-xs font-semibold text-[color:var(--color-on-media)]">
            {initialsFromName(name)}
        </span>
    ) : (
        <PersonAvatar mediaId={row.personMediaId} treeId={treeId} sex={row.personSex} name={name} initials={initialsFromName(name)} size={36} />
    );
    const body = (
        <>
            {avatar}
            <span className="flex-1 min-w-0 grid gap-px">
                <span className="flex min-w-0 items-baseline gap-1.5 text-base text-text">
                    <span className="min-w-0 truncate">
                        {label
                            ? <><span className="font-semibold">{label}</span><span className="text-text-muted"> · {name}</span></>
                            : <span className="font-semibold">{name}</span>}
                    </span>
                    {isQuayValue(row.quay) && <span className="shrink-0 rounded-full bg-surface-2 px-[7px] py-px text-xs font-medium text-text-secondary">{tl(`certainty_short_${row.quay}`)}</span>}
                </span>
                {(date || row.factPlace || row.page) && (
                    <span className="flex min-w-0 items-baseline gap-2.5 text-meta">
                        <span className="flex-1 min-w-0 truncate text-text-muted">
                            {date && <span className="date-mono">{formatDateForDisplay(date, language, words)}</span>}
                            {date && row.factPlace && ' · '}{row.factPlace}
                        </span>
                        {row.page && <span title={row.page} className="max-w-[60%] shrink-0 truncate font-mono text-text-secondary">{row.page}</span>}
                    </span>
                )}
                {row.fileMediaId != null && (
                    <CitationFileLine title={row.fileTitle} contentType={row.fileContentType} page={row.page} className="mt-0.5 justify-self-start" />
                )}
            </span>
        </>
    );
    const cls = cx('flex w-full items-center gap-3 min-h-14 py-2 pr-4 text-left', label ? 'pl-4' : 'pl-10', divided && 'border-t border-border-light');
    const tap = 'cursor-pointer active:bg-surface-2 focus-ring-inset';
    // Editors open the citation; a viewer, who can't change it, goes to the person or family.
    if (onOpen) return <button type="button" onClick={onOpen} className={cx(cls, tap)}>{body}</button>;
    if (parts.href) return <Link href={parts.href} className={cx(cls, tap, 'no-underline text-inherit')}>{body}</Link>;
    return <div className={cls}>{body}</div>;
}

function useFactLabel() {
    const tl = useTranslations('library');
    const tTypes = useTranslations('eventTypes');
    const tEvent = useTranslations('eventEdit');
    return (row: CitedByRow) => {
        const { kind } = citedByLabel(row);
        if (kind !== 'event') return tl(`kind_${kind}`);
        const type = row.eventType ?? '';
        if (row.personId == null && row.familyId != null) return familyEventLabel(type, tEvent);
        return EVENT_TYPES[type] ? tTypes(type as Parameters<typeof tTypes>[0]) : getEventDisplayType(type);
    };
}

/** One citation: page, certainty and transcription, then Remove citation with Undo. */
function CitationSheet({ row, onClose, canDelete, run, onFilesChanged }: {
    row: CitedByRow | null;
    onClose: () => void;
    canDelete: boolean;
    run: ReturnType<typeof useChange>;
    /** A file was attached or removed (#47), so the rows' paperclip lines refresh. */
    onFilesChanged: () => void;
}) {
    const [shown, setShown] = useState<CitedByRow | null>(row);
    const [shownId, setShownId] = useState<number | null>(row?.citationId ?? null);
    const [page, setPage] = useState('');
    const [quay, setQuay] = useState('');
    const [dataText, setDataText] = useState('');
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    if (row && row.citationId !== shownId) {
        setShown(row); setShownId(row.citationId);
        setPage(row.page ?? ''); setQuay(row.quay ?? ''); setDataText(row.dataText ?? ''); setConfirming(false);
    }
    if (!row && shownId != null) setShownId(null);
    const t = useTranslations('mobileLibrary');
    const tl = useTranslations('library');
    const ts = useTranslations('citeSheet');
    const { activeTreeId } = useTree();
    const label = useFactLabel();
    const r = row ?? shown;
    const dirty = r != null && (page !== (r.page ?? '') || quay !== (r.quay ?? '') || dataText !== (r.dataText ?? ''));
    const who = r ? citedByLabel(r).subject : '';
    const title = r ? `${label(r)} · ${who.split(' ')[0] ?? ''}` : '';

    const save = async () => {
        if (!r) return;
        setBusy(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            return client.citations.update(r.citationId, { Page: page.trim() || null, Quay: quay || null, DataText: dataText.trim() || null }, activeTreeId);
        }, { message: ts('toast_updated') });
        setBusy(false);
        if (ok) onClose();
    };
    const remove = async () => {
        if (!r) return;
        setBusy(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            return client.citations.remove(r.citationId, activeTreeId);
        }, { message: ts('toast_removed'), detail: title });
        setBusy(false);
        setConfirming(false);
        if (ok) onClose();
    };
    const field = 'w-full rounded-[10px] border border-border bg-surface px-3 text-md text-text placeholder:text-text-muted input-nozoom focus-ring';
    return (
        <Sheet open={row != null} onClose={onClose} title={title} size="full" dirty={dirty} onSave={save} saveDisabled={busy}>
            <div className="grid gap-4 pt-1">
                <label className="grid gap-1.5">
                    <span className="text-meta font-semibold text-text-secondary">{t('page_or_line')}</span>
                    <input value={page} onChange={(e) => setPage(e.target.value)} autoComplete="off" className={cx(field, 'h-11 font-mono')} />
                </label>
                <div className="grid gap-2">
                    <span className="text-meta font-semibold text-text-secondary">{tl('field_certainty')}</span>
                    <div role="group" aria-label={tl('field_certainty')} className="flex flex-wrap gap-x-1.5 gap-y-2.5">
                        {QUAY_VALUES.map((v) => (
                            <MobileListChip key={v} active={quay === v} label={tl(`certainty_short_${v}`)} title={tl(QUAY_LABEL_KEY[v])}
                                onClick={() => setQuay(quay === v ? '' : v)} />
                        ))}
                    </div>
                    <span className="text-meta text-text-muted">{ts('certainty_hint')}</span>
                </div>
                <label className="grid gap-1.5">
                    <span className="text-meta font-semibold text-text-secondary">{tl('field_transcription')}</span>
                    <textarea rows={3} value={dataText} onChange={(e) => setDataText(e.target.value)} placeholder={t('passage_ph')}
                        className={cx(field, 'py-2.5 leading-normal resize-none')} />
                </label>
                {r && (
                    <CitationFileField citationId={r.citationId} treeId={activeTreeId} page={page} canEdit
                        targetName={title} onChange={onFilesChanged} />
                )}
            </div>
            {canDelete && (
                <div className="-mx-4 mt-5 border-t border-border">
                    <MobileRow icon={<Trash2 />} tone="danger" label={t('remove_citation')} sub={t('remove_citation_sub')} onClick={() => setConfirming(true)} />
                </div>
            )}
            <ConfirmSheet open={confirming} title={ts('remove_title', { fact: title })} body={ts('remove_body')} confirmLabel={ts('remove_confirm')}
                keepLabel={ts('keep')} onConfirm={remove} onClose={() => setConfirming(false)} busy={busy} />
        </Sheet>
    );
}
