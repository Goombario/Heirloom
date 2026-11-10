'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronRight, Ellipsis, ImageUp, Menu, Pencil, Plus, Quote, RotateCcw, Strikethrough, Trash2 } from '@/lib/icons';
import type { CaseComment, PersonResult } from '@/lib/db/schema';
import { CopperPill, GlassButton, MobileListChip, MobileRow, PageShell, RadioRow, cx, fieldClass, showChangeToast } from '@/app/components/ui';
import { Skeleton } from '@/app/components/SkeletonLoader';
import { openAppMenu } from '@/app/components/nav/appEvents';
import { useHeroHeader } from '@/app/people/view/mobile/useHeroHeader';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { RecordBand } from '@/app/components/mobile/RecordBand';
import MediaImg from '@/app/components/MediaImg';
import PersonAvatar from '@/app/components/PersonAvatar';
import { PersonPickerSheet } from '@/app/components/PersonPickerSheet';
import { Head, Section } from '@/app/people/view/mobile/panes';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { initialsFromName } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import type { CaseDetailState } from './useCaseDetail';
import { writtenEntries } from './case-detail-helpers';

const STATUSES = ['in_progress', 'on_hold', 'closed'] as const;

/** A source the case cites, numbered once for the page: the case's citations, then sources only an entry cites. */
interface NumberedSource { sourceId: number; title: string; sub: string | null; type: string | null }

/**
 * The phone case page (#1123). Built like the source page: a dark band with the menu and the
 * pencil, the status and opened date as the eyebrow, the question in serif and the
 * background clipped to two lines. Then Journal and Evidence tabs. The journal's entries
 * carry footnote numbers that match the numbered Sources on Evidence (page-local), the
 * conclusion is pinned first, and the copper pill writes a new entry in a typing sheet.
 */
export default function MobileCasePage({ cd }: { cd: CaseDetailState }) {
    const { caseData, t, tCommon, activePermission, activeTreeId } = cd;
    const ids = useId();
    const { timestamp } = useTimestamp();
    const [tab, setTab] = useState<'journal' | 'evidence'>('journal');
    const [bgOpen, setBgOpen] = useState(false);
    const [sheet, setSheet] = useState<'menu' | 'edit' | 'close' | 'compose' | 'tags' | 'people' | 'delete' | null>(null);
    // The journal note whose strike-out sheet is open (#1251).
    const [note, setNote] = useState<CaseComment | null>(null);
    const tabsRef = useRef<HTMLDivElement>(null);

    const sources = useMemo<NumberedSource[]>(() => {
        if (!caseData) return [];
        const out: NumberedSource[] = caseData.citations.map((c) => ({ sourceId: c.SourceId, title: c.sourceTitle ?? `#${c.SourceId}`, sub: c.Page ?? c.Note, type: c.sourceType }));
        for (const e of caseData.comments) {
            if (e.citationSourceId != null && !out.some((s) => s.sourceId === e.citationSourceId)) {
                out.push({ sourceId: e.citationSourceId, title: e.citationLabel ?? `#${e.citationSourceId}`, sub: null, type: null });
            }
        }
        return out;
    }, [caseData]);

    if (!caseData) return null;
    const viewer = activePermission === 'view';
    const closed = caseData.Status === 'closed';
    const editor = !viewer && !closed;
    const canDelete = activePermission === 'owner' || activePermission === 'edit';
    const written = writtenEntries(caseData.comments);
    const evidenceCount = caseData.people.length + sources.length + caseData.media.length;
    const numberOf = (sourceId: number | null | undefined) => (sourceId == null ? null : sources.findIndex((s) => s.sourceId === sourceId) + 1 || null);

    const setStatus = async (status: string) => {
        const was = caseData.Status;
        setSheet(null);
        if (status === was) return;
        if (status === 'closed') { setSheet('close'); return; }
        if (await cd.patchCase({ Status: status })) {
            showChangeToast({ message: was === 'closed' ? t('mobile_reopened') : t('mobile_status_now', { status: t(`status_${status}`) }) });
        }
    };

    const tabs = [
        { key: 'journal' as const, label: t('mobile_tab_journal'), n: written.length },
        { key: 'evidence' as const, label: t('tab_evidence'), n: evidenceCount },
    ];

    return (
        <PageShell variant="detail" contentClassName="hidden" topBar={(
            <div className="mp-root md:hidden overflow-x-clip" style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}>
                <RecordBand
                    eyebrow={<>
                        <span className="inline-flex items-center gap-1.5 normal-case tracking-normal font-semibold text-white">
                            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-white/80" />
                            {t(`status_${caseData.Status}`)}
                        </span>
                        <span className="normal-case tracking-normal font-normal">· {t('mobile_opened')} <span className="tabular-nums">{timestamp(caseData.CreatedAt, 'date')}</span></span>
                    </>}
                    title={caseData.Title || t('untitled')}
                    onEdit={viewer ? undefined : () => setSheet('menu')}
                    editLabel={t('mobile_edit_case')}
                >
                    {caseData.Description && (
                        <div>
                            <p className={cx('m-0 serif italic text-base leading-snug text-white/80 whitespace-pre-wrap', !bgOpen && 'line-clamp-2')}>{caseData.Description}</p>
                            {caseData.Description.length > 90 && (
                                <button type="button" onClick={() => setBgOpen((v) => !v)} aria-expanded={bgOpen}
                                    className="relative mt-0.5 text-sm font-semibold text-white cursor-pointer rounded focus-ring before:absolute before:-inset-x-2 before:-inset-y-[13px] before:content-['']">
                                    {bgOpen ? t('mobile_less') : t('mobile_more')}
                                </button>
                            )}
                        </div>
                    )}
                </RecordBand>

                <div ref={tabsRef} role="tablist" aria-label={t('mobile_tabs_label')}
                    className="sticky z-20 flex bg-[color:var(--surface)] border-b border-border px-1.5"
                    style={{ top: 'calc(var(--nav-h) + var(--mp-bar-h))' }}>
                    {tabs.map((tb) => {
                        const selected = tb.key === tab;
                        return (
                            <button key={tb.key} type="button" role="tab" id={`${ids}-tab-${tb.key}`} aria-selected={selected} aria-controls={`${ids}-panel`}
                                tabIndex={selected ? 0 : -1} onClick={() => setTab(tb.key)}
                                onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const next = tb.key === 'journal' ? 'evidence' : 'journal'; setTab(next); tabsRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${ids}-tab-${next}`)}`)?.focus(); } }}
                                className={cx('shrink-0 min-h-11 px-2.5 pt-[13px] pb-[11px] text-sm whitespace-nowrap border-b-2 cursor-pointer focus-ring-inset',
                                    selected ? 'text-text font-semibold border-text' : 'text-text-muted border-transparent')}>
                                {tb.label}
                                {tb.n > 0 && <span className="font-mono font-normal text-xs text-text-muted ml-1">{tb.n}</span>}
                            </button>
                        );
                    })}
                </div>

                <div id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-tab-${tab}`}>
                    {cd.saveError && (
                        <p role="alert" className="m-0 mx-4 mt-3 rounded-lg px-3.5 py-2 text-sm bg-error-bg text-error">{cd.saveError}</p>
                    )}
                    {tab === 'journal'
                        ? <Journal cd={cd} editor={editor} numberOf={numberOf} sources={sources}
                            onCompose={() => setSheet('compose')} onPeople={() => setSheet('people')} onNote={setNote} />
                        : <Evidence cd={cd} editor={editor} sources={sources}
                            onPeople={() => setSheet('people')} onTags={() => setSheet('tags')} />}
                </div>

                {editor && tab === 'journal' && written.length > 0 && (
                    <CopperPill floating icon={<Pencil aria-hidden="true" />} onClick={() => setSheet('compose')}>{t('add_entry')}</CopperPill>
                )}

                {/* The pencil: edit the question (open cases), the status, and Delete. */}
                <Sheet open={sheet === 'menu'} onClose={() => setSheet(null)} title={t('mobile_case')}>
                    <div className="-mx-4 -mt-3">
                        {!closed && <MobileRow icon={<Pencil aria-hidden="true" />} label={t('mobile_edit_question')} end="chevron" onClick={() => setSheet('edit')} />}
                        <div className={cx('eyebrow px-4 pt-4 pb-1.5', !closed && 'border-t border-border')}>{t('field_status')}</div>
                        <div role="radiogroup" aria-label={t('field_status')}>
                            {STATUSES.map((s, i) => (
                                <RadioRow key={s} checked={caseData.Status === s} label={t(`status_${s}`)} hint={t(`mobile_status_hint_${s}`)} divided={i > 0} onSelect={() => void setStatus(s)} />
                            ))}
                        </div>
                        {canDelete && (
                            <div className="mt-2 border-t border-border">
                                <MobileRow tone="danger" icon={<Trash2 aria-hidden="true" />} label={t('delete_case_title')} onClick={() => setSheet('delete')} />
                            </div>
                        )}
                    </div>
                </Sheet>
                <EditSheet open={sheet === 'edit'} cd={cd} onClose={() => setSheet(null)} />
                <CloseSheet open={sheet === 'close'} cd={cd} onClose={() => setSheet(null)} />
                <ComposeSheet open={sheet === 'compose'} cd={cd} onClose={() => setSheet(null)} />
                {note && <NoteSheet key={note.Id} note={note} cd={cd} onClose={() => setNote(null)} />}
                <TagsSheet open={sheet === 'tags'} cd={cd} onClose={() => setSheet(null)} />
                <PersonPickerSheet open={sheet === 'people'} onClose={() => setSheet(null)} title={t('add_person')} treeId={activeTreeId} multiple
                    excludeIds={cd.casePeople.map((p) => p.Id)}
                    onPick={(picked) => {
                        setSheet(null);
                        const add = picked.flatMap((p) => (p.kind === 'existing' ? [p.person] : [])) as PersonResult[];
                        if (add.length) void cd.handlePeopleChange([...cd.casePeople, ...add]);
                    }} />
                <ConfirmSheet open={sheet === 'delete'} title={t('mobile_delete_title')} body={t('mobile_delete_body')}
                    confirmLabel={t('delete_case_title')} keepLabel={tCommon('cancel')} busy={cd.deleting}
                    onConfirm={() => void cd.handleDelete()} onClose={() => setSheet(null)} />
            </div>
        )} />
    );
}

/**
 * The phone case page while it loads: the band (the menu works already), the two tabs
 * and three journal entries, so the page settles in place instead of jumping from the
 * desktop detail skeleton (the owner's phone review of #1117).
 */
export function MobileCaseSkeleton() {
    const tn = useTranslations('nav');
    useHeroHeader();
    return (
        <PageShell variant="detail" busy contentClassName="hidden" topBar={(
            <div className="mp-root md:hidden overflow-x-clip" data-testid="mobile-case-skeleton">
                <div className="hero-dark mp-slim-bar !rounded-none !shadow-none grid gap-2.5 !pl-4 !pr-3 !pb-[18px]"
                    style={{ paddingTop: 'calc(8px + var(--mp-sat))' }}>
                    <div className="flex justify-between -ml-1">
                        <GlassButton label={tn('toggle_menu')} icon={<Menu />} onClick={openAppMenu} />
                        <span aria-hidden="true" className="w-[34px] h-[34px] rounded-full bg-black/[0.38] border border-[color:var(--color-glass-border)]" />
                    </div>
                    <Skeleton className="h-3 w-[46%]" />
                    <Skeleton className="h-7 w-[78%]" />
                    <div className="grid gap-1.5"><Skeleton className="h-3.5 w-[94%]" /><Skeleton className="h-3.5 w-[70%]" /></div>
                </div>
                <div aria-hidden="true" className="flex gap-5 items-center h-11 px-4 bg-[color:var(--surface)] border-b border-border">
                    <Skeleton className="h-3.5 w-16" /><Skeleton className="h-3.5 w-20" />
                </div>
                <ul aria-hidden="true" className="m-0 p-0 list-none">
                    {[0, 1, 2].map((i) => (
                        <li key={i} className={cx('grid gap-2 px-4 py-3.5', i > 0 && 'border-t border-border')}>
                            <div className="flex items-center gap-2">
                                <Skeleton className="w-6 h-6 rounded-full" /><Skeleton className="h-3 w-24" /><Skeleton className="ml-auto h-3 w-16" />
                            </div>
                            <Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-[92%]" />{i !== 1 && <Skeleton className="h-3.5 w-[55%]" />}
                        </li>
                    ))}
                </ul>
            </div>
        )} />
    );
}

/** A dashed "Add …" row that ends an editable section. */
function AddRow({ label, onClick, divided = true }: { label: string; onClick: () => void; divided?: boolean }) {
    return (
        <button type="button" onClick={onClick}
            className={cx('flex w-full items-center gap-3 min-h-14 px-4 py-2.5 text-left cursor-pointer active:bg-surface-2 focus-ring-inset', divided && 'border-t border-border')}>
            <span aria-hidden="true" className="grid place-items-center w-[34px] h-[34px] shrink-0 rounded-[10px] border-[1.5px] border-dashed border-border text-text-muted">
                <Plus className="w-[17px] h-[17px]" />
            </span>
            <span className="text-base font-semibold text-link">{label}</span>
        </button>
    );
}

function Journal({ cd, editor, numberOf, sources, onCompose, onPeople, onNote }: {
    cd: CaseDetailState; editor: boolean; numberOf: (sourceId: number | null | undefined) => number | null;
    sources: NumberedSource[]; onCompose: () => void; onPeople: () => void; onNote: (note: CaseComment) => void;
}) {
    const { caseData, t, activeTreeId } = cd;
    const { timestamp } = useTimestamp();
    if (!caseData) return null;
    const written = writtenEntries(caseData.comments);

    if (written.length === 0 && editor) {
        const steps = [
            { done: (caseData.Title ?? '').trim() !== '', label: t('step_name_case'), sub: t('step_name_case_sub'), onClick: undefined },
            { done: caseData.people.length > 0, label: t('step_add_people'), sub: t('step_add_people_sub'), onClick: onPeople },
            { done: caseData.citations.length > 0, label: t('step_cite_source'), sub: t('step_cite_source_sub'), onClick: () => cd.setShowAttachSource(true) },
            { done: false, label: t('step_log_known'), sub: t('step_log_known_sub'), onClick: onCompose },
        ];
        const next = steps.findIndex((s) => !s.done);
        return (
            <>
                <div className="grid justify-items-center gap-2 px-6 pt-8 pb-2 text-center">
                    <b className="serif text-lg font-semibold">{t('start_research')}</b>
                    <p className="m-0 max-w-[30ch] text-sm text-text-muted">{t('start_research_sub')}</p>
                    <p className="m-0 font-mono text-meta text-text-muted">{t('steps_progress', { done: steps.filter((s) => s.done).length, total: 4 })}</p>
                </div>
                <ol className="m-0 p-0 list-none">
                    {steps.map((s, i) => (
                        <li key={s.label}>
                            <button type="button" onClick={s.onClick} disabled={s.done || !s.onClick}
                                className={cx('flex w-full items-center gap-3 min-h-14 px-4 py-2.5 text-left focus-ring-inset', i > 0 && 'border-t border-border',
                                    !s.done && s.onClick ? 'cursor-pointer active:bg-surface-2' : 'cursor-default')}>
                                <span aria-hidden="true" className={cx('grid place-items-center w-7 h-7 shrink-0 rounded-full text-xs font-semibold font-mono',
                                    s.done ? 'bg-success text-white' : i === next ? 'bg-primary text-white' : 'border border-border text-text-muted')}>
                                    {s.done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                                </span>
                                <span className="flex-1 min-w-0 grid gap-px">
                                    <span className="text-base font-semibold text-text">{s.label}{s.done && <span className="sr-only"> ({t('mobile_done')})</span>}</span>
                                    <span className="text-meta text-text-muted">{s.sub}</span>
                                </span>
                                {!s.done && s.onClick && <ChevronRight className="w-[18px] h-[18px] text-text-muted shrink-0" aria-hidden="true" />}
                            </button>
                        </li>
                    ))}
                </ol>
            </>
        );
    }
    if (caseData.comments.length === 0) return <p className="m-0 px-4 pt-6 text-base text-text-muted">{t('no_journal_entries')}</p>;

    // The conclusion is pinned first; the rest run newest first.
    const newest = [...caseData.comments].reverse();
    const conclusion = newest.find((c) => c.Kind === 'conclusion' && caseData.Status === 'closed');
    const rest = newest.filter((c) => c !== conclusion);
    const entry = (c: CaseComment, i: number) => {
        const author = c.UserName || c.UserEmail || `#${c.UserId}`;
        if (c.Kind === 'status') {
            return (
                <li key={c.Id} className={cx('px-4 py-2.5 text-meta text-text-muted', i > 0 && 'border-t border-border')} data-entry-kind="status">
                    <span className="font-medium text-text-secondary">{t(`journal_status_${c.Body}`)}</span> · <span className="tabular-nums">{timestamp(c.CreatedAt)}</span> · {author}
                </li>
            );
        }
        const n = numberOf(c.citationSourceId);
        const isConclusion = c === conclusion;
        const struck = c.StruckAt != null;
        return (
            <li key={c.Id} className={cx('relative px-4 py-3.5', i > 0 && 'border-t border-border', isConclusion && 'bg-card')} data-struck={struck || undefined}>
                {isConclusion && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-[3px] bg-success" />}
                {isConclusion
                    ? <div className="eyebrow !text-success mb-1">{t('journal_conclusion')} · <span className="normal-case tracking-normal font-normal tabular-nums">{timestamp(c.CreatedAt, 'date')}</span></div>
                    : (
                        <div className="flex items-center gap-2 mb-1.5">
                            <PersonAvatar as="span" size={24} name={author} initials={initialsFromName(author)} />
                            <b className="text-sm font-semibold">{author}</b>
                            <span className="ml-auto text-meta text-text-muted tabular-nums">{timestamp(c.CreatedAt)}</span>
                            {cd.canStrikeNote(c) ? (
                                <button type="button" onClick={() => onNote(c)}
                                    aria-label={t(struck ? 'journal_unstrike_label' : 'journal_strike_label', { date: timestamp(c.CreatedAt) })}
                                    className="-my-2 -mr-2 grid place-items-center w-9 h-9 rounded-full text-text-muted cursor-pointer active:bg-surface-2 focus-ring">
                                    <Ellipsis className="w-4 h-4" aria-hidden="true" />
                                </button>
                            ) : null}
                        </div>
                    )}
                <p className={cx('m-0 text-base leading-relaxed whitespace-pre-wrap', struck ? 'text-text-muted line-through decoration-text-muted' : 'text-text')}>
                    {struck && <span className="sr-only">{t('journal_struck_sr')} </span>}
                    {c.Body}
                    {n && <sup className={cx('ml-0.5 font-mono text-xs text-link', struck && 'opacity-60')}>{n}</sup>}
                </p>
                {struck && <p className="m-0 mt-1 text-meta text-text-muted" data-testid="struck-line">{struckLine(c, timestamp, t)}</p>}
                {c.media && (
                    <MediaImg mediaId={c.media.Id} contentType={c.media.ContentType} treeId={activeTreeId} alt={c.media.Title || t('section_media')} className={cx('mt-2 max-w-[60%] rounded-lg object-cover', struck && 'opacity-50 grayscale')} />
                )}
                {n && (
                    <p className={cx('m-0 mt-1.5 text-meta text-text-muted truncate', struck && 'opacity-60')}>
                        <b className="font-mono font-medium text-link mr-1">{n}</b>{sources[n - 1]?.title}
                    </p>
                )}
            </li>
        );
    };
    return (
        <ul className="m-0 p-0 list-none">
            {conclusion && entry(conclusion, 0)}
            {rest.map((c, i) => entry(c, conclusion ? i + 1 : i))}
        </ul>
    );
}

function Evidence({ cd, editor, sources, onPeople, onTags }: {
    cd: CaseDetailState; editor: boolean; sources: NumberedSource[]; onPeople: () => void; onTags: () => void;
}) {
    const { caseData, t, tCommon, activeTreeId } = cd;
    if (!caseData) return null;
    return (
        <>
            <Section first>
                <Head title={t('section_people')} count={caseData.people.length} />
                {caseData.people.length === 0 && !editor && <p className="m-0 px-4 py-2 text-sm text-text-muted">{t('no_people')}</p>}
                {caseData.people.map((p, i) => {
                    const name = displayFullName(p) || tCommon('unknown');
                    return (
                        <MobileRow key={p.Id} divided={i > 0} href={`/people/view?id=${p.Id}`}
                            lead={<PersonAvatar as="span" size={40} name={name} initials={initialsFromName(name)} sex={p.Sex} treeId={activeTreeId}
                                mediaId={p.PrimaryMediaId ?? undefined} focalX={p.FocalX ?? undefined} focalY={p.FocalY ?? undefined} focalRadius={p.FocalRadius ?? undefined} />}
                            label={<span className="serif text-md font-semibold">{name}</span>} />
                    );
                })}
                {editor && cd.caseReady && <AddRow label={t('add_person')} onClick={onPeople} divided={caseData.people.length > 0} />}
            </Section>
            <Section>
                <Head title={t('section_sources')} count={sources.length} />
                {sources.length === 0 && !editor && <p className="m-0 px-4 py-2 text-sm text-text-muted">{t('no_citations')}</p>}
                {sources.map((s, i) => (
                    <MobileRow key={s.sourceId} divided={i > 0} href={`/library/view?id=${s.sourceId}`}
                        lead={<span aria-hidden="true" className="grid place-items-center w-[34px] h-[34px] shrink-0 rounded-[10px] bg-surface-2 text-text [&_svg]:w-[17px] [&_svg]:h-[17px]"><Quote /></span>}
                        label={<span className="flex items-baseline gap-2"><span className="flex-1 min-w-0 serif font-semibold truncate">{s.title}</span><span className="font-mono text-meta text-link">{i + 1}</span></span>}
                        sub={s.sub ?? undefined} />
                ))}
                {editor && cd.caseReady && <AddRow label={t('cite_source')} onClick={() => cd.setShowAttachSource(true)} divided={sources.length > 0} />}
            </Section>
            <Section>
                <Head title={t('section_media')} count={caseData.media.length} />
                {caseData.media.length === 0 && !editor && <p className="m-0 px-4 py-2 text-sm text-text-muted">{t('no_media')}</p>}
                {caseData.media.length > 0 && (
                    <div className="grid grid-cols-3 gap-0.5 px-0.5">
                        {caseData.media.map((m, idx) => (
                            <button key={m.Id} type="button" onClick={() => cd.setLightboxIndex(idx)} aria-label={m.Title || t('section_media')}
                                className="relative aspect-square overflow-hidden bg-surface-2 cursor-pointer focus-ring-inset">
                                <MediaImg mediaId={m.Id} contentType={m.ContentType} treeId={activeTreeId} width={256} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </button>
                        ))}
                    </div>
                )}
                {editor && cd.caseReady && (
                    <AddRow label={t('add_media')} onClick={() => cd.setShowUploadModal(true)} divided={false} />
                )}
            </Section>
            <Section>
                <Head title={t('section_tags')} />
                <div className="flex flex-wrap gap-1.5 px-4 pt-1 pb-3">
                    {caseData.Tags?.map((tag) => <MobileListChip key={tag} label={tag} tabIndex={-1} aria-disabled className="!cursor-default" />)}
                    {editor && <MobileListChip label={t('mobile_edit_tags')} icon={<Pencil className="w-3.5 h-3.5" aria-hidden="true" />} onClick={onTags} />}
                    {!caseData.Tags?.length && !editor && <span className="text-sm text-text-muted">{t('no_tags')}</span>}
                </div>
            </Section>
        </>
    );
}

function EditSheet({ open, cd, onClose }: { open: boolean; cd: CaseDetailState; onClose: () => void }) {
    const { caseData, t } = cd;
    const ids = useId();
    const [title, setTitle] = useState('');
    const [desc, setDesc] = useState('');
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) { setTitle(caseData?.Title ?? ''); setDesc(caseData?.Description ?? ''); }
    }
    const dirty = title !== (caseData?.Title ?? '') || desc !== (caseData?.Description ?? '');
    return (
        <Sheet open={open} onClose={onClose} title={t('mobile_edit_case_title')} size="full" dirty={dirty} saveDisabled={!title.trim() || cd.saving}
            onSave={async () => {
                if (await cd.patchCase({ Title: title.trim(), Description: desc.trim() || null })) {
                    onClose();
                    showChangeToast({ message: t('mobile_case_saved') });
                }
            }}>
            <div className="grid gap-5 pt-1">
                <div className="grid gap-1.5">
                    <label htmlFor={`${ids}-q`} className="text-meta font-semibold text-text-secondary">{t('field_title_label')}</label>
                    <input id={`${ids}-q`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('title_edit_placeholder')} autoComplete="off"
                        className="w-full h-[46px] rounded-[10px] border border-border bg-surface px-3 text-md text-text input-nozoom focus-ring" />
                </div>
                <div className="grid gap-1.5">
                    <label htmlFor={`${ids}-b`} className="text-meta font-semibold text-text-secondary">{t('field_description_label')}</label>
                    <textarea id={`${ids}-b`} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('desc_edit_placeholder')} rows={5}
                        className={cx(fieldClass(), 'min-h-[110px] text-md')} />
                </div>
            </div>
        </Sheet>
    );
}

function CloseSheet({ open, cd, onClose }: { open: boolean; cd: CaseDetailState; onClose: () => void }) {
    const { t } = cd;
    const ids = useId();
    const [text, setText] = useState('');
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setText('');
    }
    return (
        <Sheet open={open} onClose={onClose} title={t('close_case_title')} size="full" dirty={text.trim() !== ''} saveLabel={t('close_case_confirm')}
            saveDisabled={!text.trim() || cd.saving}
            onSave={async () => {
                const was = cd.caseData?.Status ?? 'in_progress';
                if (await cd.patchCase({ Status: 'closed', Conclusion: text.trim() })) {
                    onClose();
                    // Undo reopens it as it was; the conclusion stays in the journal as an entry.
                    showChangeToast({ message: t('mobile_case_closed'), onUndo: () => { void cd.patchCase({ Status: was }); } });
                }
            }}>
            <div className="grid gap-1.5 pt-1">
                <label htmlFor={`${ids}-c`} className="text-meta font-semibold text-text-secondary">{t('mobile_what_found')}</label>
                <textarea id={`${ids}-c`} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('mobile_what_found_placeholder')} rows={5}
                    className={cx(fieldClass(), 'min-h-[110px] text-md')} />
                <p className="m-0 text-meta text-text-muted">{t('mobile_close_hint')}</p>
            </div>
        </Sheet>
    );
}

function ComposeSheet({ open, cd, onClose }: { open: boolean; cd: CaseDetailState; onClose: () => void }) {
    const { t, tCommon } = cd;
    const fileRef = useRef<HTMLInputElement>(null);
    const ids = useId();
    const pending = cd.pendingCommentCite;
    const dirty = cd.commentBody.trim() !== '' || pending != null || cd.journalFile != null;
    const discard = () => { cd.setCommentBody(''); cd.setPendingCommentCite(null); cd.setJournalFile(null); cd.setJournalFilePreview(null); onClose(); };
    return (
        <Sheet open={open} onClose={discard} title={t('mobile_new_entry')} size="full" dirty={dirty} saveLabel={t('mobile_post')}
            saveDisabled={!cd.commentBody.trim() || cd.postingComment}
            onSave={async () => { if (await cd.postComment()) onClose(); }}>
            <label htmlFor={`${ids}-e`} className="sr-only">{t('mobile_entry')}</label>
            <textarea id={`${ids}-e`} value={cd.commentBody} onChange={(e) => cd.setCommentBody(e.target.value)} placeholder={t('composer_placeholder')} rows={7}
                className={cx(fieldClass(), 'min-h-[160px] text-md mt-1')} />
            <div className="-mx-4 mt-2.5">
                <MobileRow icon={<Quote aria-hidden="true" />}
                    label={pending ? t('mobile_cited', { title: pending.sourceTitle ?? pending.newSource?.Title ?? '' }) : t('mobile_cite_a_source')}
                    end={pending ? 'none' : 'chevron'} onClick={() => (pending ? cd.setPendingCommentCite(null) : cd.setShowComposerCite(true))}
                    aria-label={pending ? tCommon('remove') : undefined} />
                <MobileRow divided icon={<ImageUp aria-hidden="true" />}
                    label={cd.journalFile ? t('mobile_photo_attached') : t('mobile_attach_photo')}
                    end={cd.journalFile ? 'none' : 'chevron'}
                    onClick={() => (cd.journalFile ? (cd.setJournalFile(null), cd.setJournalFilePreview(null)) : fileRef.current?.click())} />
                <input ref={fileRef} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden="true"
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        cd.setJournalFile(f);
                        cd.setJournalFilePreview(URL.createObjectURL(f));
                        e.target.value = '';
                    }} />
            </div>
            {cd.journalFilePreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cd.journalFilePreview} alt="" className="mt-2 w-[120px] aspect-[4/3] rounded-lg object-cover" />
            )}
        </Sheet>
    );
}

/** "Struck out by Ada · 3 Nov 2026, 14:02 · wrong Ada" (#1251). */
function struckLine(c: CaseComment, timestamp: (value: string) => string, t: CaseDetailState['t']): string {
    const when = timestamp(c.StruckAt ?? '');
    const head = c.StruckByName ? t('journal_struck_by', { name: c.StruckByName, date: when }) : t('journal_struck', { date: when });
    return c.StruckReason ? `${head} · ${c.StruckReason}` : head;
}

/**
 * Strike a journal note out with an optional reason, or undo its strike (#1251).
 * Entries are never edited or deleted (ADR 0042).
 */
function NoteSheet({ note, cd, onClose }: { note: CaseComment; cd: CaseDetailState; onClose: () => void }) {
    const { t } = cd;
    const { timestamp } = useTimestamp();
    const ids = useId();
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    if (note.StruckAt != null) {
        return (
            <Sheet open onClose={onClose} title={t('journal_struck_title')}>
                <p className="m-0 text-base text-text-muted line-through whitespace-pre-wrap line-clamp-4">{note.Body}</p>
                <p className="m-0 mt-1.5 text-meta text-text-muted">{struckLine(note, timestamp, t)}</p>
                <div className="-mx-4 mt-4 border-t border-border">
                    <MobileRow icon={<RotateCcw aria-hidden="true" />} label={t('journal_unstrike')} disabled={busy}
                        onClick={async () => {
                            setBusy(true);
                            const ok = await cd.setNoteStruck(note, false);
                            setBusy(false);
                            if (ok) onClose();
                        }} />
                </div>
            </Sheet>
        );
    }
    return (
        <Sheet open onClose={onClose} title={t('journal_strike_title')} dirty={reason.trim() !== ''} saveWhenClean
            saveLabel={t('journal_strike')} saveDisabled={busy}
            onSave={async () => {
                setBusy(true);
                const ok = await cd.setNoteStruck(note, true, reason);
                setBusy(false);
                if (ok) onClose();
            }}>
            <p className="m-0 flex gap-2 text-base text-text-2">
                <Strikethrough className="w-[18px] h-[18px] mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
                {t('journal_strike_body')}
            </p>
            <label htmlFor={`${ids}-r`} className="block mt-4 mb-1 text-sm font-medium text-text-2">{t('journal_strike_reason')}</label>
            <input id={`${ids}-r`} type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={t('journal_strike_reason_placeholder')} className={cx(fieldClass(), 'text-md')} />
        </Sheet>
    );
}

function TagsSheet({ open, cd, onClose }: { open: boolean; cd: CaseDetailState; onClose: () => void }) {
    const { caseData, t, tCommon } = cd;
    const typed = cd.tagInput.trim();
    return (
        <Sheet open={open} onClose={onClose} title={t('section_tags')}>
            <div className="flex flex-wrap gap-1.5 pt-1">
                {caseData?.Tags?.map((tag) => (
                    <MobileListChip key={tag} label={tag} active dismissible dismissLabel={tCommon('remove_named', { name: tag })}
                        onClick={() => void cd.removeTag(tag)} onDismiss={() => void cd.removeTag(tag)} />
                ))}
                {!caseData?.Tags?.length && <span className="text-sm text-text-muted">{t('no_tags')}</span>}
            </div>
            <form className="mt-4" onSubmit={(e) => { e.preventDefault(); if (typed) void cd.addTag(); }}>
                <input value={cd.tagInput} onChange={(e) => cd.setTagInput(e.target.value)} placeholder={t('add_a_tag')} aria-label={t('add_a_tag')} autoComplete="off"
                    className="w-full h-11 rounded-full border border-border bg-surface px-4 text-md text-text placeholder:text-text-muted input-nozoom focus-ring" />
                {typed && (
                    <button type="submit" className="flex w-full items-center gap-3 min-h-12 mt-1 text-left text-base font-semibold text-link cursor-pointer rounded-lg focus-ring">
                        <Plus className="w-[17px] h-[17px]" aria-hidden="true" />{t('mobile_add_tag_named', { tag: typed })}
                    </button>
                )}
            </form>
        </Sheet>
    );
}
