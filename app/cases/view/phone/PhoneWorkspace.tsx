'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import MediaLightbox from '@/app/components/lightbox/MediaLightbox';
import { CopperPill, PageShell, cx, showSuccessToast } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { RecordBand } from '@/app/components/mobile/RecordBand';
import { CheckCircle2, ChevronDown, ClipboardList, Pencil, Search } from '@/lib/icons';
import { getDataClient } from '@/lib/data';
import type { CaseComment, CaseRequest, Media } from '@/lib/db/schema';
import type { CaseFindingInput, CaseRequestInput, CloseCaseInput, UpdateCaseInput } from '@/lib/data/types';
import type { CaseDetailState } from '../useCaseDetail';
import { useCaseWorkspace } from '../desktop/useCaseWorkspace';
import { LeadStatusDot } from '../desktop/LeadStatus';
import { FindRecord, type FindStart } from '../desktop/FindRecord';
import { RecordView } from '../desktop/RecordView';
import { EvidenceView } from '../desktop/EvidenceView';
import { AnswerClose } from '../desktop/AnswerClose';
import { ClosedAnswer } from '../desktop/ClosedAnswer';
import { LeadDialog } from '../desktop/LeadDialog';
import { AboutDialog } from '../desktop/AboutDialog';
import { AddMediaDialog } from '../desktop/AddMediaDialog';
import { CasePrint, ExportDialog } from '../desktop/CaseExport';
import { yearsLabel } from '../desktop/LeadsRail';
import type { ClaimConflict } from '../desktop/claims';
import { PhoneLead } from './PhoneLead';
import { AddNoteSheet, PhoneJournal, StrikeSheet } from './PhoneJournal';
import { AboutCaseSheet, CaseMenuSheet, LeadMenuSheet, LeadsSheet, LogReplySheet, WhichHoldsSheet } from './PhoneSheets';

type SheetKind =
    | { kind: 'leads' } | { kind: 'lead-menu' } | { kind: 'case-menu' }
    | { kind: 'which'; conflict: ClaimConflict } | { kind: 'reply'; request: CaseRequest }
    | { kind: 'find'; leadId: number; start: FindStart } | { kind: 'record'; findingId: number }
    | { kind: 'close' } | { kind: 'note' } | { kind: 'strike'; note: CaseComment }
    | { kind: 'new-lead' } | { kind: 'edit-lead'; leadId: number } | { kind: 'about' } | { kind: 'edit-about' }
    | { kind: 'add-media'; leadId: number } | { kind: 'export' } | { kind: 'drop'; leadId: number } | { kind: 'delete' };

/**
 * The phone research case (#135), built on the desktop workspace's model (#58):
 * the band with the menu and the case ⋯, a lead switcher that opens the Leads
 * sheet, Lead and Journal tabs, and the copper pill (Find a record, Add a note).
 * All evidence and a closed case's answer replace the lead in the same frame.
 */
export function PhoneWorkspace({ cd }: { cd: CaseDetailState }) {
    const t = useTranslations('caseResearch');
    const tCases = useTranslations('cases');
    const format = useFormatter();
    const ids = useId();
    const { caseData, activeTreeId, canEdit, canDelete } = cd;
    const caseId = caseData?.Id ?? 0;
    const closed = caseData?.Status === 'closed';
    const ws = useCaseWorkspace(caseId, activeTreeId, caseData?.UpdatedAt, closed);
    const [tab, setTab] = useState<'main' | 'journal'>('main');
    const [sheet, setSheet] = useState<SheetKind | null>(null);
    const [lightbox, setLightbox] = useState<Media | null>(null);
    const [lastFiled, setLastFiled] = useState<number[] | null>(null);
    const [printing, setPrinting] = useState(0);
    const tabsRef = useRef<HTMLDivElement>(null);
    const manage = cd.activePermission !== 'view';

    const settledLeadIds = useMemo(() => new Set(ws.summaries.filter((s) => s.status === 'settled').map((s) => s.lead.Id)), [ws.summaries]);
    const view = ws.view;
    const open = view?.kind === 'lead' ? ws.summaries.find((s) => s.lead.Id === view.leadId) : undefined;
    const page: 'lead' | 'evidence' | 'answer' | 'close' | 'none' = view == null ? 'none' : view.kind;
    const leads = ws.workspace?.leads ?? [];

    if (!caseData) return null;
    const client = () => getDataClient();
    const after = (ok: number | null | false) => { if (ok !== false) void cd.fetchCase(); return ok !== false; };
    const shut = () => setSheet(null);
    const editable = canEdit && !closed;
    const changedTree = (ws.workspace?.findings ?? []).some((f) => f.claims.some((c) => c.AppliedAt != null));
    const firstLead = () => { if (ws.summaries[0]) ws.open({ kind: 'lead', leadId: ws.summaries[0].lead.Id }); };

    const addFinding = async (input: CaseFindingInput) => {
        const ok = after(await ws.run(async () => (await client()).cases.addFinding(caseId, input, activeTreeId)));
        if (ok) { showSuccessToast(input.kind === 'record' ? t('record_added') : t('nothing_saved')); if (input.kind === 'record') shut(); }
        return ok;
    };
    const addRequest = async (input: CaseRequestInput) => {
        const ok = after(await ws.run(async () => (await client()).cases.addRequest(caseId, input, activeTreeId)));
        if (ok) { showSuccessToast(t('request_saved')); shut(); }
        return ok;
    };
    const saveAbout = async (patch: UpdateCaseInput) => {
        try {
            await (await client()).cases.update(caseId, { ...patch, mediaIds: caseData.media.map((m) => m.Id) }, activeTreeId);
            await cd.fetchCase();
            return true;
        } catch (err) {
            ws.setError(err instanceof Error ? err.message : String(err));
            return false;
        }
    };
    const closeCase = async (input: CloseCaseInput) => {
        const ok = after(await ws.run(async () => (await client()).cases.close(caseId, input, activeTreeId)));
        if (ok) {
            shut();
            ws.open({ kind: 'answer' });
            setTab('main');
            showSuccessToast(input.apply.length > 0 ? t('closed_with_changes', { count: input.apply.length }) : t('closed_toast'));
        }
    };
    const leadChange = (leadId: number, action: 'settle' | 'reopen' | 'drop') =>
        ws.run(async () => (await client()).cases.changeLead(caseId, leadId, { action }, activeTreeId)).then(after);

    // The eyebrow: Research · status · Opened date, or Closed · outcome · date.
    const closedOn = format.dateTime(new Date(caseData.ClosedAt ?? caseData.UpdatedAt), { dateStyle: 'medium' });
    const status = closed
        ? [tCases('status_closed'), caseData.Outcome && t(`outcome_${caseData.Outcome}`)].filter(Boolean).join(' · ')
        : tCases(`status_${caseData.Status}`);
    const when = closed ? closedOn : t('opened_on', { date: format.dateTime(new Date(caseData.CreatedAt), { dateStyle: 'medium' }) });

    const aboutLine = [
        caseData.people.length > 0 && t('people_count', { count: caseData.people.length }),
        yearsLabel(caseData.FromYear, caseData.ToYear),
        caseData.Place,
    ].filter(Boolean).join(' · ');

    const leadIndex = open ? ws.summaries.indexOf(open) + 1 : 0;
    const mainLabel = page === 'evidence' ? t('tab_evidence') : page === 'answer' ? t('tab_answer') : t('lead');
    const tabs = [
        { key: 'main' as const, label: mainLabel, n: page === 'evidence' ? ws.evidenceCount : null },
        { key: 'journal' as const, label: t('journal'), n: caseData.comments.length },
    ];
    const pill = !editable ? null
        : tab === 'journal' ? { label: t('add_note'), icon: <Pencil aria-hidden="true" />, onClick: () => setSheet({ kind: 'note' }) }
            : page === 'lead' && open && open.status !== 'settled'
                ? { label: t('find_record'), icon: <Search aria-hidden="true" />, onClick: () => setSheet({ kind: 'find', leadId: open.lead.Id, start: { mode: 'search' } }) }
                : null;

    const findLead = sheet?.kind === 'find' ? leads.find((l) => l.Id === sheet.leadId) : undefined;
    const recordFinding = sheet?.kind === 'record' ? ws.workspace?.findings.find((f) => f.Id === sheet.findingId) : undefined;

    return (
        <PageShell variant="detail" contentClassName="hidden" topBar={(
            <div className="mp-root md:hidden overflow-x-clip" style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}>
                <RecordBand
                    eyebrow={<>
                        <span>{t('eyebrow')}</span>
                        <span className="inline-flex items-center gap-1.5 normal-case tracking-normal font-semibold text-white">
                            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-white/80" />{status}
                        </span>
                        <span className="normal-case tracking-normal font-normal">· {when}</span>
                    </>}
                    title={caseData.Title || tCases('untitled')}
                    onEdit={() => setSheet({ kind: 'case-menu' })}
                    editLabel={t('case_menu')}
                    editIcon="more"
                />

                <div className="sticky z-20" style={{ top: 'calc(var(--nav-h) + var(--mp-bar-h))' }}>
                    <button type="button" onClick={() => setSheet({ kind: 'leads' })} aria-haspopup="dialog"
                        className="flex w-full items-center gap-3 min-h-[62px] pl-4 pr-3.5 py-2.5 bg-card border-0 border-b border-border text-left cursor-pointer focus-ring-inset">
                        {open ? <LeadStatusDot status={open.status} className="!w-2.5 !h-2.5" />
                            : <span aria-hidden="true" className="grid place-items-center w-7 h-7 shrink-0 rounded-lg bg-surface-2 text-text">
                                {page === 'answer' ? <CheckCircle2 className="w-[15px] h-[15px]" /> : <ClipboardList className="w-[15px] h-[15px]" />}
                            </span>}
                        <span className="grid gap-0.5 flex-1 min-w-0">
                            <span className="eyebrow">
                                {open ? t.rich('lead_n_of', { n: leadIndex, total: ws.summaries.length, status: t(`status_${open.status}`), b: (c) => <b className="font-mono font-medium tracking-normal">{c}</b> })
                                    : t('case_section')}
                            </span>
                            <span className="serif font-semibold text-md text-text truncate">
                                {open ? open.lead.Question : page === 'evidence' ? t('all_evidence') : page === 'answer' ? t('the_answer') : t('no_leads')}
                            </span>
                        </span>
                        <span className="inline-flex items-center gap-1 text-sm font-semibold text-link">{t('leads')}<ChevronDown className="w-4 h-4" aria-hidden="true" /></span>
                    </button>
                    <div ref={tabsRef} role="tablist" aria-label={t('tabs_label')} className="flex gap-[18px] px-4 bg-[color:var(--surface)] border-b border-border">
                        {tabs.map((tb) => {
                            const selected = tb.key === tab;
                            return (
                                <button key={tb.key} type="button" role="tab" id={`${ids}-tab-${tb.key}`} aria-selected={selected} aria-controls={`${ids}-panel`}
                                    tabIndex={selected ? 0 : -1} onClick={() => setTab(tb.key)}
                                    onKeyDown={(e) => {
                                        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                                        const next = tb.key === 'main' ? 'journal' : 'main';
                                        setTab(next);
                                        tabsRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${ids}-tab-${next}`)}`)?.focus();
                                    }}
                                    className={cx('min-h-11 pt-[13px] pb-[11px] text-base border-0 border-b-2 bg-transparent cursor-pointer focus-ring-inset',
                                        selected ? 'text-text font-semibold border-text' : 'text-text-muted border-transparent')}>
                                    {tb.label}
                                    {tb.n != null && tb.n > 0 && <span className="font-mono font-normal text-meta text-text-muted ml-1">{tb.n}</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-tab-${tab}`}>
                    {(ws.error || cd.saveError) && (
                        <p role="alert" className="m-0 mx-4 mt-3 rounded-lg px-3.5 py-2 text-sm bg-error-bg text-error">{ws.error ?? cd.saveError}</p>
                    )}
                    {!ws.workspace ? (
                        <p className="m-0 px-4 pt-4 text-sm text-text-muted" role="status">{t('loading')}</p>
                    ) : tab === 'journal' ? (
                        <PhoneJournal cd={cd} leads={leads} openLeadId={open?.lead.Id ?? null} lastFiled={lastFiled} onClearFiled={() => setLastFiled(null)}
                            onStrike={(note) => setSheet({ kind: 'strike', note })} />
                    ) : page === 'answer' ? (
                        <div className="px-4 pt-4">
                            <ClosedAnswer caseData={caseData} findings={ws.workspace.findings} summaries={ws.summaries}
                                canUndo={cd.activePermission === 'owner' || cd.activePermission === 'edit'} canReopen={manage} busy={ws.busy || cd.saving}
                                onUndo={(claim) => { void ws.run(async () => (await client()).cases.undoApplied(caseId, claim.Id, activeTreeId)).then((r) => { if (after(r)) showSuccessToast(t('change_undone')); }); }}
                                onReopen={() => { void cd.patchCase({ Status: 'in_progress' }).then((ok) => { if (ok) firstLead(); }); }} />
                        </div>
                    ) : page === 'evidence' ? (
                        <div className="px-4 pt-4">
                            <EvidenceView findings={ws.workspace.findings} leads={leads} treeId={activeTreeId}
                                onOpenRecord={(f) => setSheet({ kind: 'record', findingId: f.Id })} onOpenMedia={setLightbox} />
                        </div>
                    ) : open ? (
                        <PhoneLead
                            key={open.lead.Id}
                            summary={open}
                            findings={ws.workspace.findings}
                            facts={ws.workspace.facts}
                            requests={ws.workspace.requests}
                            comments={caseData.comments}
                            settledLeadIds={settledLeadIds}
                            treeId={activeTreeId}
                            canEdit={editable}
                            busy={ws.busy}
                            onMenu={editable ? () => setSheet({ kind: 'lead-menu' }) : undefined}
                            onDecide={(claim, decision) => { void ws.run(async () => (await client()).cases.decideClaim(caseId, claim.Id, decision, activeTreeId)); }}
                            onReply={(request) => setSheet({ kind: 'reply', request })}
                            onWhichHolds={(conflict) => setSheet({ kind: 'which', conflict })}
                            onOpenRecord={(f) => setSheet({ kind: 'record', findingId: f.Id })}
                            onOpenMedia={setLightbox}
                            onAddMedia={() => setSheet({ kind: 'add-media', leadId: open.lead.Id })}
                        />
                    ) : (
                        <p className="m-0 px-4 pt-4 text-sm text-text-muted">{t('no_leads')}</p>
                    )}
                </div>

                {pill && <CopperPill floating icon={pill.icon} onClick={pill.onClick}>{pill.label}</CopperPill>}

                <LeadsSheet open={sheet?.kind === 'leads'} summaries={ws.summaries} currentLeadId={open?.lead.Id ?? null}
                    evidenceCount={ws.evidenceCount} aboutLine={aboutLine} canAdd={editable}
                    onPick={(leadId) => { shut(); ws.open({ kind: 'lead', leadId }); setTab('main'); }}
                    onNewLead={() => setSheet({ kind: 'new-lead' })}
                    onEvidence={() => { shut(); ws.open({ kind: 'evidence' }); setTab('main'); }}
                    onAbout={() => setSheet({ kind: 'about' })}
                    onClose={shut} />
                {open && (
                    <LeadMenuSheet open={sheet?.kind === 'lead-menu'} summary={open} onClose={shut}
                        onEdit={() => setSheet({ kind: 'edit-lead', leadId: open.lead.Id })}
                        onAddMedia={() => setSheet({ kind: 'add-media', leadId: open.lead.Id })}
                        onSettle={() => { void leadChange(open.lead.Id, 'settle'); }}
                        onReopen={() => { void leadChange(open.lead.Id, 'reopen'); }}
                        onDrop={() => setSheet({ kind: 'drop', leadId: open.lead.Id })} />
                )}
                <CaseMenuSheet open={sheet?.kind === 'case-menu'} onClose={shut}
                    manage={manage} closed={closed} onHold={caseData.Status === 'on_hold'}
                    canClose={editable} canExport={ws.workspace != null}
                    canDelete={manage && canDelete && !changedTree}
                    onAnswer={() => setSheet({ kind: 'close' })}
                    onEditQuestion={() => setSheet({ kind: 'edit-about' })}
                    onToggleHold={() => { void cd.patchCase({ Status: caseData.Status === 'on_hold' ? 'in_progress' : 'on_hold' }); }}
                    onReopen={() => { void cd.patchCase({ Status: 'in_progress' }).then((ok) => { if (ok) firstLead(); }); }}
                    onCopyLink={() => { void navigator.clipboard?.writeText(window.location.href).then(() => showSuccessToast(t('link_copied'))); }}
                    onExport={() => setSheet({ kind: 'export' })}
                    onDelete={() => setSheet({ kind: 'delete' })} />
                {sheet?.kind === 'which' && (
                    <WhichHoldsSheet conflict={sheet.conflict} onClose={shut}
                        onDecide={(claim, decision) => { void ws.run(async () => (await client()).cases.decideClaim(caseId, claim.Id, decision, activeTreeId)); }} />
                )}
                {sheet?.kind === 'reply' && (
                    <LogReplySheet request={sheet.request} onClose={shut}
                        onSave={async (reply) => {
                            const request = sheet.request;
                            const ok = after(await ws.run(async () => (await client()).cases.replyToRequest(caseId, request.Id, reply, activeTreeId)));
                            // They sent it: go on to add the record, tied to the request.
                            if (ok && reply.state === 'received' && request.LeadId != null) {
                                setTimeout(() => setSheet({ kind: 'find', leadId: request.LeadId!, start: { mode: 'have', requestId: request.Id, repository: request.Holder ?? undefined } }), 0);
                            }
                            return ok;
                        }} />
                )}
                <Sheet open={sheet?.kind === 'find' && findLead != null} onClose={shut} title={t('find_record')} size="full">
                    {sheet?.kind === 'find' && findLead && (
                        <div className="grid gap-3">
                            <p className="m-0 -mt-2 text-sm text-text-muted">{t('for_lead', { lead: findLead.Question })}</p>
                            <FindRecord key={`${findLead.Id}:${sheet.start.mode}:${sheet.start.requestId ?? ''}`}
                                lead={findLead} leads={leads.filter((l) => !settledLeadIds.has(l.Id))} caseData={caseData} treeId={activeTreeId}
                                start={sheet.start} onAddFinding={addFinding}
                                onAddRequest={(input) => addRequest({ ...input, leadId: findLead.Id })} />
                        </div>
                    )}
                </Sheet>
                <Sheet open={sheet?.kind === 'record' && recordFinding != null} onClose={shut} title={t('record')} size="full">
                    {recordFinding && <RecordView finding={recordFinding} leads={leads} treeId={activeTreeId} onOpenMedia={setLightbox} />}
                </Sheet>
                <Sheet open={sheet?.kind === 'close'} onClose={shut} title={t('answer_and_close')} size="full">
                    {sheet?.kind === 'close' && ws.workspace && (
                        <AnswerClose caseId={caseId} treeId={activeTreeId} leads={ws.workspace.leads} summaries={ws.summaries} busy={ws.busy}
                            canReplace={cd.activePermission === 'owner' || cd.activePermission === 'edit'}
                            onGoToLead={(leadId) => { shut(); ws.open({ kind: 'lead', leadId }); setTab('main'); }}
                            onCancel={shut}
                            onClose={(input) => { void closeCase(input); }} />
                    )}
                </Sheet>
                <AddNoteSheet open={sheet?.kind === 'note'} cd={cd} leads={leads.filter((l) => l.DroppedAt == null)} openLeadId={open?.lead.Id ?? null}
                    onFiled={setLastFiled} onClose={shut} />
                {sheet?.kind === 'strike' && <StrikeSheet key={sheet.note.Id} note={sheet.note} cd={cd} onClose={shut} />}

                <AboutCaseSheet open={sheet?.kind === 'about'} caseData={caseData} treeId={activeTreeId} canEdit={manage && !closed}
                    onEdit={() => setSheet({ kind: 'edit-about' })} onAddPhotos={() => cd.setShowUploadModal(true)} onOpenPhoto={(i) => cd.setLightboxIndex(i)}
                    onClose={shut} />

                {/* The desktop's forms, as full sheets. */}
                {sheet?.kind === 'new-lead' && (
                    <LeadDialog sheet casePeople={caseData.people} treeId={activeTreeId} onClose={shut}
                        onSave={async (input) => {
                            const id = await ws.run(async () => (await client()).cases.addLead(caseId, input, activeTreeId));
                            if (typeof id === 'number') { ws.open({ kind: 'lead', leadId: id }); setTab('main'); }
                            return after(id);
                        }} />
                )}
                {sheet?.kind === 'edit-lead' && (() => {
                    const lead = leads.find((l) => l.Id === sheet.leadId);
                    return lead ? (
                        <LeadDialog sheet lead={lead} casePeople={caseData.people} treeId={activeTreeId} onClose={shut}
                            onSave={async (input) => after(await ws.run(async () => (await client()).cases.changeLead(caseId, lead.Id, { action: 'edit', ...input }, activeTreeId)))} />
                    ) : null;
                })()}
                {sheet?.kind === 'edit-about' && <AboutDialog sheet caseData={caseData} treeId={activeTreeId} onClose={shut} onSave={saveAbout} />}
                {sheet?.kind === 'add-media' && (() => {
                    const lead = leads.find((l) => l.Id === sheet.leadId);
                    return lead ? (
                        <AddMediaDialog sheet lead={lead} treeId={activeTreeId} onClose={shut}
                            onSave={async (input) => {
                                const ok = after(await ws.run(async () => (await client()).cases.addFinding(caseId, input, activeTreeId)));
                                if (ok) showSuccessToast(t('media_added'));
                                return ok;
                            }} />
                    ) : null;
                })()}
                {sheet?.kind === 'export' && ws.workspace && (
                    <ExportDialog sheet caseData={caseData} workspace={ws.workspace} onClose={shut} onPrint={() => setPrinting((n) => n + 1)} />
                )}
                {printing > 0 && ws.workspace && (
                    <CasePrint key={printing} caseData={caseData} workspace={ws.workspace} summaries={ws.summaries} onDone={() => setPrinting(0)} />
                )}

                <ConfirmSheet open={sheet?.kind === 'drop'} title={t('drop_lead_title', { question: sheet?.kind === 'drop' ? leads.find((l) => l.Id === sheet.leadId)?.Question ?? '' : '' })}
                    body={t('drop_lead_body')} confirmLabel={t('drop_lead')} keepLabel={t('cancel')} busy={ws.busy}
                    onConfirm={() => {
                        if (sheet?.kind !== 'drop') return;
                        const leadId = sheet.leadId;
                        shut();
                        void leadChange(leadId, 'drop').then((ok) => {
                            const next = ws.summaries.find((s) => s.lead.Id !== leadId);
                            if (ok && next) ws.open({ kind: 'lead', leadId: next.lead.Id });
                        });
                    }}
                    onClose={shut} />
                <ConfirmSheet open={sheet?.kind === 'delete'} title={tCases('mobile_delete_title')} body={tCases('mobile_delete_body')}
                    confirmLabel={tCases('delete_case_title')} keepLabel={t('cancel')} busy={cd.deleting}
                    onConfirm={() => void cd.handleDelete()} onClose={shut} />

                {lightbox && (
                    <MediaLightbox items={[lightbox]} index={0} treeId={activeTreeId} canEdit={canEdit} canDelete={false} context="library"
                        onClose={() => setLightbox(null)} onChangeIndex={() => {}}
                        onTagsChanged={() => { void cd.fetchCase(); }}
                        onDeleted={() => { setLightbox(null); void cd.fetchCase(); }} />
                )}
            </div>
        )} />
    );
}
