'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { CaseWithRelations } from '@/lib/db/schema';
import { Plus } from '@/lib/icons';
import {
    CopperPill, EmptyState, InlineDataError, MobileListDivider, MobileListFilters, MobileListHeader,
    MobileListToggleChip, PageShell, RadioRow, cx, fieldClass,
} from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { useErrorToast } from '@/app/components/useErrorToast';
import { getDataClient } from '@/lib/data';
import { SkeletonList } from '@/app/components/SkeletonLoader';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { CaseStatus } from './CaseStatus';
import { writtenEntries } from './view/case-detail-helpers';

type StatusFilter = 'in_progress' | 'on_hold' | 'closed' | '';

interface MobileCasesProps {
    treeId: number | null;
    phase: 'pending' | 'loading' | 'ready';
    loadError: string | null;
    onRetry: () => void;
    canEdit: boolean;
    search: string;
    onSearch: (v: string) => void;
    statusFilter: StatusFilter;
    onStatus: (v: StatusFilter) => void;
    tagFilter: string;
    onTag: (v: string) => void;
    tags: string[];
    counts: { inProgress: number; onHold: number; closed: number };
    visible: CaseWithRelations[];
    closedRecent: CaseWithRelations[];
    /** A search, tag or status narrowed an empty list (so the empty state offers Clear). */
    filtered: boolean;
    /** Every case, before the status chip; tells a new tree from one with only closed cases. */
    total: number;
    onClearFilters: () => void;
}

/**
 * The phone Cases list (#1122): the people-list standard. The filter field and status
 * chips with counts, a Tag chip with its own sheet, full-width rows (title, then status
 * and counts, the time at the right), Closed recently under the open cases, and the
 * floating New case pill for editors. The last-note quote and the tags leave the row.
 */
export function MobileCases(p: MobileCasesProps) {
    const t = useTranslations('cases');
    const tm = useTranslations('mobileCases');
    const tc = useTranslations('common');
    const router = useRouter();
    const [tagSheet, setTagSheet] = useState(false);
    const [newOpen, setNewOpen] = useState(false);
    // /cases/new on a phone lands here with ?new=1 (#1123): open the sheet, drop the flag.
    useEffect(() => {
        if (!new URLSearchParams(window.location.search).has('new')) return;
        window.history.replaceState(window.history.state, '', '/cases');
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the URL once on arrival
        setNewOpen(true);
    }, []);

    const status = (key: Exclude<StatusFilter, ''>, label: string, count: number) => (
        <MobileListToggleChip label={label} count={count} on={p.statusFilter === key}
            clearLabel={tc('clear_filter_named', { name: label })}
            onTap={() => p.onStatus(p.statusFilter === key ? '' : key)} onClear={() => p.onStatus('')} />
    );
    const shownLabel = p.statusFilter === 'in_progress' ? t('filter_in_progress')
        : p.statusFilter === 'on_hold' ? t('filter_on_hold')
        : p.statusFilter === 'closed' ? t('filter_closed') : tm('open');

    return (
        <PageShell topBar={<MobileListHeader title={t('title')} />} contentClassName="max-md:p-0!" busy={p.phase === 'loading'}>
            <MobileListFilters value={p.search} onChange={p.onSearch} placeholder={tm('filter_cases')}>
                {status('in_progress', t('filter_in_progress'), p.counts.inProgress)}
                {status('on_hold', t('filter_on_hold'), p.counts.onHold)}
                {status('closed', t('filter_closed'), p.counts.closed)}
                {p.tags.length > 0 && (
                    <MobileListToggleChip label={p.tagFilter ? tm('tag_named', { tag: p.tagFilter }) : tm('tag')} on={!!p.tagFilter}
                        clearLabel={tc('clear_filter_named', { name: p.tagFilter })}
                        onTap={() => (p.tagFilter ? p.onTag('') : setTagSheet(true))} onClear={() => p.onTag('')} />
                )}
            </MobileListFilters>

            {p.phase === 'loading' ? (
                <div className="pt-4"><SkeletonList rows={8} /></div>
            ) : p.phase === 'pending' ? null : p.loadError && p.total === 0 ? (
                <div className="p-4"><InlineDataError message={p.loadError} retryLabel={t('retry')} onRetry={p.onRetry} /></div>
            ) : (
                <>
                    {p.loadError && <div className="px-4 pt-3"><InlineDataError message={p.loadError} retryLabel={t('retry')} onRetry={p.onRetry} /></div>}
                    {p.visible.length === 0 ? (
                        p.filtered ? (
                            <EmptyState variant="filtered" message={t('no_match')} clearLabel={tc('clear_filters')} onClear={p.onClearFilters} />
                        ) : (
                            <EmptyState variant="empty" title={p.total === 0 ? t('empty_title') : t('no_open_cases')} message={t('new_case_hint')} />
                        )
                    ) : (
                        <>
                            {/* Cases only sort by recent activity, so the meta row says so instead of offering a sheet. */}
                            <div className="flex items-center justify-between gap-3 min-h-11 px-4 pt-3 pb-1 text-meta text-text-muted">
                                <span className="font-mono">{tm('count', { count: p.visible.length, status: shownLabel.toLowerCase() })}</span>
                                <span>{tm('recent_activity')}</span>
                            </div>
                            <ul className="m-0 p-0 list-none">
                                {p.visible.map((c, i) => <CaseRow key={c.Id} c={c} divided={i > 0} />)}
                            </ul>
                        </>
                    )}
                    {p.statusFilter !== 'closed' && p.closedRecent.length > 0 && (
                        <section className="mt-3.5 border-t border-border">
                            <MobileListDivider>
                                <span className="flex justify-between">{t('closed_recently')}<span className="font-mono normal-case tracking-normal">{p.counts.closed}</span></span>
                            </MobileListDivider>
                            <ul className="m-0 p-0 list-none">
                                {p.closedRecent.map((c, i) => <CaseRow key={c.Id} c={c} divided={i > 0} />)}
                            </ul>
                        </section>
                    )}
                    <div className="h-[88px]" aria-hidden="true" />
                </>
            )}

            {p.canEdit && (
                <CopperPill floating icon={<Plus aria-hidden="true" />} onClick={() => setNewOpen(true)}>{t('new_case')}</CopperPill>
            )}

            <NewCaseSheet open={newOpen} treeId={p.treeId} onClose={() => setNewOpen(false)}
                // Leave the sheet open: closing it takes its history step back, which would
                // undo a push made in the same tick. It unmounts with the page instead.
                onCreated={(id) => router.push(`/cases/view?id=${id}`)} />

            <Sheet open={tagSheet} onClose={() => setTagSheet(false)} title={t('field_tags')}>
                <div role="radiogroup" aria-label={t('field_tags')} className="-mx-4 -mt-3">
                    <RadioRow checked={!p.tagFilter} label={t('all_tags')} divided={false} onSelect={() => { p.onTag(''); setTagSheet(false); }} />
                    {p.tags.map((tag) => (
                        <RadioRow key={tag} checked={p.tagFilter === tag} label={tag} divided onSelect={() => { p.onTag(tag); setTagSheet(false); }} />
                    ))}
                </div>
            </Sheet>
        </PageShell>
    );
}

function CaseRow({ c, divided }: { c: CaseWithRelations; divided: boolean }) {
    const t = useTranslations('cases');
    const { activityTime } = useTimestamp();
    const closed = c.Status === 'closed';
    const conclusion = closed && c.latestComment?.Kind === 'conclusion' ? c.latestComment.Body : null;
    return (
        <li className={divided ? 'border-t border-border' : undefined}>
            <Link href={`/cases/view?id=${c.Id}`}
                className="flex items-start gap-3 min-h-[60px] px-4 py-[11px] no-underline text-inherit active:bg-surface-2 focus-ring-inset">
                <span className="flex-1 min-w-0 grid gap-0.5">
                    <span className="serif text-md font-semibold leading-snug text-text line-clamp-2">
                        {closed && <><span className="text-success font-semibold mr-1.5" aria-hidden="true">✓</span><span className="sr-only">{t('status_closed')}: </span></>}{c.Title}
                    </span>
                    <span className="text-meta text-text-muted truncate">
                        {conclusion ?? (
                            <>
                                <CaseStatus status={c.Status} className="!text-meta align-[-1px]" />
                                {' · '}{t('people_count', { count: c.people?.length ?? 0 })}
                                {' · '}{t('sources_count', { count: c.citations?.length ?? 0 })}
                                {' · '}{t('notes_count', { count: writtenEntries(c.comments ?? []).length })}
                            </>
                        )}
                    </span>
                </span>
                <span className="shrink-0 pt-[3px] text-meta text-text-muted tabular-nums">{activityTime(c.UpdatedAt)}</span>
            </Link>
        </li>
    );
}

/** New case on a phone (#1123): the question and an optional background, then Create. */
function NewCaseSheet({ open, treeId, onClose, onCreated }: { open: boolean; treeId: number | null; onClose: () => void; onCreated: (id: number) => void }) {
    const t = useTranslations('cases');
    const tm = useTranslations('mobileCases');
    const ids = useId();
    const { reportError } = useErrorToast();
    const [title, setTitle] = useState('');
    const [desc, setDesc] = useState('');
    const [saving, setSaving] = useState(false);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) { setTitle(''); setDesc(''); setSaving(false); }
    }
    const create = async () => {
        if (!title.trim()) return;
        setSaving(true);
        try {
            const client = await getDataClient();
            const created = await client.cases.create({ Title: title.trim(), Description: desc.trim() || null, Status: 'in_progress', Tags: [], personIds: [] }, treeId);
            onCreated(created.Id);
        } catch (e) {
            reportError(e);
            setSaving(false);
        }
    };
    return (
        <Sheet open={open} onClose={onClose} title={t('new_case')} size="full" dirty={title.trim() !== '' || desc.trim() !== ''}
            onSave={create} saveLabel={tm('create')} saveDisabled={!title.trim() || saving}>
            <div className="grid gap-5 pt-1">
                <div className="grid gap-1.5">
                    <label htmlFor={`${ids}-q`} className="text-meta font-semibold text-text-secondary">{t('field_title_label')}</label>
                    <input id={`${ids}-q`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('title_edit_placeholder')} autoComplete="off"
                        className="w-full h-[46px] rounded-[10px] border border-border bg-surface px-3 text-md text-text input-nozoom focus-ring" />
                </div>
                <div className="grid gap-1.5">
                    <label htmlFor={`${ids}-b`} className="text-meta font-semibold text-text-secondary">
                        {t('field_description_label')} <span className="font-normal text-text-muted">· {tm('optional')}</span>
                    </label>
                    <textarea id={`${ids}-b`} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('desc_edit_placeholder')} rows={5}
                        className={cx(fieldClass(), 'min-h-[110px] text-md')} />
                </div>
                <p className="m-0 text-meta text-text-muted">{tm('new_case_hint')}</p>
            </div>
        </Sheet>
    );
}
