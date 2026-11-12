'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import MediaLightbox from '@/app/components/lightbox/MediaLightbox';
import { Banner, Button, CoverBand, PageShell, RecordMenu, showSuccessToast, type RecordMenuItem } from '@/app/components/ui';
import { CheckCircle2, Search, X } from '@/lib/icons';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { getDataClient } from '@/lib/data';
import type { CaseClaim, CaseRequest, Media } from '@/lib/db/schema';
import type { CaseFindingInput, CaseRequestInput, CloseCaseInput, UpdateCaseInput } from '@/lib/data/types';
import type { CaseDetailState } from '../useCaseDetail';
import { LeadsRail } from './LeadsRail';
import { LeadView } from './LeadView';
import { LeadDialog } from './LeadDialog';
import { ReplyDialog } from './ReplyDialog';
import { AboutDialog } from './AboutDialog';
import { useCaseWorkspace } from './useCaseWorkspace';
import { FindRecord, type FindStart } from './FindRecord';
import { RecordView } from './RecordView';
import { ResearchSide, type SideTab } from './ResearchSide';
import { WorkspaceJournal } from './WorkspaceJournal';
import { EvidenceView } from './EvidenceView';
import { AnswerClose } from './AnswerClose';
import { ClosedAnswer } from './ClosedAnswer';

type Dialog =
    | { kind: 'new-lead' }
    | { kind: 'edit-lead'; leadId: number }
    | { kind: 'reply'; request: CaseRequest }
    | { kind: 'about' }
    | { kind: 'drop'; leadId: number };

/** What the right column's first tab holds: Find a record for a lead, or one finding's record. */
type Panel = { kind: 'find'; leadId: number; start: FindStart } | { kind: 'record'; findingId: number };

/**
 * The desktop research workspace (#58, K1b): the case header with Answer and
 * close and the ⋯ menu; the leads rail; the open lead; and the journal beside it.
 * The phone keeps its own case page.
 */
export function ResearchWorkspace({ cd }: { cd: CaseDetailState }) {
    const t = useTranslations('caseResearch');
    const tCases = useTranslations('cases');
    const format = useFormatter();
    const { caseData, activeTreeId, canEdit, canDelete } = cd;
    const caseId = caseData?.Id ?? 0;
    const closed = caseData?.Status === 'closed';
    const ws = useCaseWorkspace(caseId, activeTreeId, caseData?.UpdatedAt, closed);
    const [dialog, setDialog] = useState<Dialog | null>(null);
    const [lightbox, setLightbox] = useState<Media | null>(null);
    const [panel, setPanel] = useState<Panel | null>(null);
    const [tab, setTab] = useState<SideTab>('record');
    const manage = cd.activePermission !== 'view';

    const settledLeadIds = useMemo(() => new Set(ws.summaries.filter((s) => s.status === 'settled').map((s) => s.lead.Id)), [ws.summaries]);
    const open = ws.view?.kind === 'lead' ? ws.summaries.find((s) => s.lead.Id === (ws.view as { leadId: number }).leadId) : undefined;

    if (!caseData) return null;
    const client = () => getDataClient();
    const after = (ok: number | null | false) => { if (ok !== false) void cd.fetchCase(); return ok !== false; };

    const openPanel = (next: Panel) => { setPanel(next); setTab('record'); };
    const openLeads = (ws.workspace?.leads ?? []).filter((l) => !settledLeadIds.has(l.Id));
    // Find a record follows the lead it was opened for; switching leads closes it.
    const findLead = panel?.kind === 'find' && open?.lead.Id === panel.leadId ? open.lead : null;
    const recordFinding = panel?.kind === 'record' ? ws.workspace?.findings.find((f) => f.Id === panel.findingId) : undefined;
    const sideLabel = findLead ? t('find_record') : recordFinding ? t('record') : null;

    const addFinding = async (input: CaseFindingInput) => {
        const id = await ws.run(async () => (await client()).cases.addFinding(caseId, input, activeTreeId));
        const ok = after(id);
        if (ok) {
            showSuccessToast(input.kind === 'record' ? t('record_added') : t('nothing_saved'));
            if (input.kind === 'record' && typeof id === 'number') openPanel({ kind: 'record', findingId: id });
        }
        return ok;
    };
    const addRequest = async (input: CaseRequestInput) => {
        const ok = after(await ws.run(async () => (await client()).cases.addRequest(caseId, input, activeTreeId)));
        if (ok) { showSuccessToast(t('request_saved')); setPanel(null); }
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

    // A case that changed the tree can't be deleted until those changes are undone (ADR 0046).
    const changedTree = (ws.workspace?.findings ?? []).some((f) => f.claims.some((c) => c.AppliedAt != null));
    const firstLead = () => { if (ws.summaries[0]) ws.open({ kind: 'lead', leadId: ws.summaries[0].lead.Id }); };

    const closeCase = async (input: CloseCaseInput) => {
        const ok = after(await ws.run(async () => (await client()).cases.close(caseId, input, activeTreeId)));
        if (ok) {
            ws.open({ kind: 'answer' });
            showSuccessToast(input.apply.length > 0 ? t('closed_with_changes', { count: input.apply.length }) : t('closed_toast'));
        }
    };
    const undo = async (claim: CaseClaim) => {
        const ok = after(await ws.run(async () => (await client()).cases.undoApplied(caseId, claim.Id, activeTreeId)));
        if (ok) showSuccessToast(t('change_undone'));
    };

    const caseMenu: RecordMenuItem[] = !manage ? [] : [
        ...(!closed ? [{ label: t('edit_question'), onSelect: () => setDialog({ kind: 'about' }) }] : []),
        ...(!closed ? [caseData.Status === 'on_hold'
            ? { label: t('resume_case'), onSelect: () => { void cd.patchCase({ Status: 'in_progress' }); } }
            : { label: t('put_on_hold'), onSelect: () => { void cd.patchCase({ Status: 'on_hold' }); } }] : []),
        ...(closed ? [{ label: t('reopen_case'), onSelect: () => { void cd.patchCase({ Status: 'in_progress' }); } }] : []),
        {
            label: t('copy_link'), separated: true, onSelect: () => {
                void navigator.clipboard?.writeText(window.location.href).then(() => showSuccessToast(t('link_copied')));
            },
        },
        ...(canDelete && !changedTree ? [{ label: t('delete_case'), danger: true, separated: true, onSelect: () => cd.setShowDeleteConfirm(true) }] : []),
    ];

    const closedOn = format.dateTime(new Date(caseData.ClosedAt ?? caseData.UpdatedAt), { dateStyle: 'medium' });
    const statusLine = !closed
        ? tCases(`status_${caseData.Status}`)
        : caseData.Outcome
            ? t('closed_outcome', { outcome: t(`outcome_${caseData.Outcome}`), date: closedOn })
            : t('closed_on', { date: closedOn });

    return (
        <PageShell variant="workspace" className="pb-10">
            {/* Wider than a record column: three columns sit side by side. */}
            <div className="mx-auto w-full max-w-[1400px] px-4 md:px-7 py-6">
            <div className="mb-5">
                <CoverBand
                    variant="short"
                    eyebrow={t('eyebrow')}
                    title={caseData.Title || tCases('untitled')}
                    titleSize="record"
                    meta={(
                        <>
                            <span>{statusLine}</span>
                            {' · '}
                            <span>{t('opened_on', { date: format.dateTime(new Date(caseData.CreatedAt), { dateStyle: 'medium' }) })}</span>
                        </>
                    )}
                    actions={(
                        <>
                            {canEdit && !closed && (
                                <Button icon={<CheckCircle2 className="w-4 h-4" aria-hidden="true" />} onClick={() => ws.open({ kind: 'close' })}>{t('answer_and_close')}</Button>
                            )}
                            <RecordMenu recordName={caseData.Title} items={caseMenu} tone="island" />
                        </>
                    )}
                />
            </div>

            {(ws.error || cd.saveError) && (
                <Banner tone="error" className="mb-4">
                    <span className="flex items-start gap-3">
                        <span className="flex-1">{ws.error ?? cd.saveError}</span>
                        <button type="button" aria-label={t('dismiss')} onClick={() => { ws.setError(null); cd.setSaveError(null); }}
                            className="grid place-items-center w-6 h-6 rounded-full bg-transparent border-0 text-current cursor-pointer focus-ring">
                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                    </span>
                </Banner>
            )}

            <div className="grid gap-6 items-start grid-cols-[248px_minmax(0,1fr)_minmax(320px,380px)]">
                <LeadsRail
                    caseData={caseData}
                    treeId={activeTreeId}
                    summaries={ws.summaries}
                    view={ws.view}
                    evidenceCount={ws.evidenceCount}
                    canEdit={canEdit && !closed}
                    closed={closed}
                    onOpen={ws.open}
                    onNewLead={() => setDialog({ kind: 'new-lead' })}
                    onEditAbout={() => setDialog({ kind: 'about' })}
                    onAddPhotos={() => cd.setShowUploadModal(true)}
                    onOpenPhoto={(i) => cd.setLightboxIndex(i)}
                    onCite={() => cd.setShowAttachSource(true)}
                    onOpenCitation={cd.openCaseCitation}
                />

                <section aria-label={t('main_label')} className="min-w-0 rounded-panel bg-card border border-border p-6">
                    {!ws.workspace ? (
                        <p className="m-0 text-sm text-text-muted" role="status">{t('loading')}</p>
                    ) : ws.view?.kind === 'close' ? (
                        <AnswerClose
                            caseId={caseId}
                            treeId={activeTreeId}
                            leads={ws.workspace.leads}
                            summaries={ws.summaries}
                            busy={ws.busy}
                            canReplace={cd.activePermission === 'owner' || cd.activePermission === 'edit'}
                            onGoToLead={(leadId) => ws.open({ kind: 'lead', leadId })}
                            onCancel={firstLead}
                            onClose={(input) => { void closeCase(input); }}
                        />
                    ) : ws.view?.kind === 'answer' ? (
                        <ClosedAnswer
                            caseData={caseData}
                            findings={ws.workspace.findings}
                            summaries={ws.summaries}
                            canUndo={cd.activePermission === 'owner' || cd.activePermission === 'edit'}
                            canReopen={manage}
                            busy={ws.busy || cd.saving}
                            onUndo={(claim) => { void undo(claim); }}
                            onReopen={() => { void cd.patchCase({ Status: 'in_progress' }).then((ok) => { if (ok) firstLead(); }); }}
                        />
                    ) : ws.view?.kind === 'evidence' ? (
                        <EvidenceView
                            findings={ws.workspace.findings}
                            leads={ws.workspace.leads}
                            treeId={activeTreeId}
                            onOpenRecord={(f) => openPanel({ kind: 'record', findingId: f.Id })}
                            onOpenMedia={setLightbox}
                        />
                    ) : open ? (
                        <LeadView
                            key={open.lead.Id}
                            summary={open}
                            findings={ws.workspace.findings}
                            requests={ws.workspace.requests}
                            comments={caseData.comments}
                            settledLeadIds={settledLeadIds}
                            treeId={activeTreeId}
                            canEdit={canEdit && !closed}
                            busy={ws.busy}
                            onEdit={() => setDialog({ kind: 'edit-lead', leadId: open.lead.Id })}
                            onSettle={() => { void ws.run(async () => (await client()).cases.changeLead(caseId, open.lead.Id, { action: 'settle' }, activeTreeId)).then(after); }}
                            onReopen={() => { void ws.run(async () => (await client()).cases.changeLead(caseId, open.lead.Id, { action: 'reopen' }, activeTreeId)).then(after); }}
                            onDrop={() => setDialog({ kind: 'drop', leadId: open.lead.Id })}
                            onDecide={(claim, decision) => { void ws.run(async () => (await client()).cases.decideClaim(caseId, claim.Id, decision, activeTreeId)); }}
                            onReply={(request) => setDialog({ kind: 'reply', request })}
                            onOpenMedia={setLightbox}
                            openRecordId={recordFinding?.Id ?? null}
                            onOpenRecord={(f) => openPanel({ kind: 'record', findingId: f.Id })}
                            actions={canEdit && !closed && (
                                <Button icon={<Search className="w-4 h-4" aria-hidden="true" />} onClick={() => openPanel({ kind: 'find', leadId: open.lead.Id, start: { mode: 'search' } })}>
                                    {t('find_record')}
                                </Button>
                            )}
                        />
                    ) : (
                        <p className="m-0 text-sm text-text-muted">{t('no_leads')}</p>
                    )}
                </section>

                <aside aria-label={t('side_label')} className="min-w-0">
                    <ResearchSide
                        recordLabel={sideLabel}
                        tab={tab}
                        onTab={setTab}
                        onCloseRecord={() => setPanel(null)}
                        journal={<WorkspaceJournal cd={cd} leads={ws.workspace?.leads ?? []} openLeadId={open?.lead.Id ?? null} />}
                        record={findLead && panel?.kind === 'find' ? (
                            <FindRecord
                                key={`${findLead.Id}:${panel.start.mode}:${panel.start.requestId ?? ''}`}
                                lead={findLead}
                                leads={openLeads}
                                caseData={caseData}
                                treeId={activeTreeId}
                                start={panel.start}
                                onAddFinding={addFinding}
                                onAddRequest={(input) => addRequest({ ...input, leadId: findLead.Id })}
                            />
                        ) : recordFinding ? (
                            <RecordView finding={recordFinding} leads={ws.workspace?.leads ?? []} treeId={activeTreeId} onOpenMedia={setLightbox} />
                        ) : null}
                    />
                </aside>
            </div>

            {dialog?.kind === 'new-lead' && (
                <LeadDialog
                    casePeople={caseData.people}
                    treeId={activeTreeId}
                    onClose={() => setDialog(null)}
                    onSave={async (input) => {
                        const id = await ws.run(async () => (await client()).cases.addLead(caseId, input, activeTreeId));
                        if (typeof id === 'number') ws.open({ kind: 'lead', leadId: id });
                        return after(id);
                    }}
                />
            )}
            {dialog?.kind === 'edit-lead' && (() => {
                const lead = ws.workspace?.leads.find((l) => l.Id === dialog.leadId);
                return lead ? (
                    <LeadDialog
                        lead={lead}
                        casePeople={caseData.people}
                        treeId={activeTreeId}
                        onClose={() => setDialog(null)}
                        onSave={async (input) => after(await ws.run(async () => (await client()).cases.changeLead(caseId, lead.Id, { action: 'edit', ...input }, activeTreeId)))}
                    />
                ) : null;
            })()}
            {dialog?.kind === 'reply' && (
                <ReplyDialog
                    request={dialog.request}
                    onClose={() => setDialog(null)}
                    onSave={async (reply) => {
                        const request = dialog.request;
                        const ok = after(await ws.run(async () => (await client()).cases.replyToRequest(caseId, request.Id, reply, activeTreeId)));
                        // They sent it: go on to add the record, tied to the request.
                        if (ok && reply.state === 'received' && request.LeadId != null) {
                            openPanel({ kind: 'find', leadId: request.LeadId, start: { mode: 'have', requestId: request.Id, repository: request.Holder ?? undefined } });
                        }
                        return ok;
                    }}
                />
            )}
            {dialog?.kind === 'about' && (
                <AboutDialog caseData={caseData} treeId={activeTreeId} onClose={() => setDialog(null)} onSave={saveAbout} />
            )}
            {dialog?.kind === 'drop' && (
                <DropLeadConfirm
                    question={ws.workspace?.leads.find((l) => l.Id === dialog.leadId)?.Question ?? ''}
                    onCancel={() => setDialog(null)}
                    onConfirm={async () => {
                        const leadId = dialog.leadId;
                        setDialog(null);
                        const ok = after(await ws.run(async () => (await client()).cases.changeLead(caseId, leadId, { action: 'drop' }, activeTreeId)));
                        if (ok) {
                            const next = ws.summaries.find((s) => s.lead.Id !== leadId);
                            if (next) ws.open({ kind: 'lead', leadId: next.lead.Id });
                        }
                    }}
                />
            )}
            {lightbox && (
                <MediaLightbox
                    items={[lightbox]}
                    index={0}
                    treeId={activeTreeId}
                    canEdit={canEdit}
                    canDelete={false}
                    context="library"
                    onClose={() => setLightbox(null)}
                    onChangeIndex={() => {}}
                    onTagsChanged={() => { void cd.fetchCase(); }}
                    onDeleted={() => { setLightbox(null); void cd.fetchCase(); }}
                />
            )}
            </div>
        </PageShell>
    );
}

function DropLeadConfirm({ question, onConfirm, onCancel }: { question: string; onConfirm: () => void; onCancel: () => void }) {
    const t = useTranslations('caseResearch');
    return (
        <DangerConfirm
            title={t('drop_lead_title', { question })}
            body={t('drop_lead_body')}
            confirmLabel={t('drop_lead')}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    );
}

function DangerConfirm({ title, body, confirmLabel, onConfirm, onCancel }: { title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
    const tc = useTranslations('common');
    return (
        <ConfirmDialog
            open
            variant="calm"
            tone="danger"
            title={title}
            body={<p className="text-text-secondary text-sm">{body}</p>}
            confirmLabel={confirmLabel}
            cancelLabel={tc('cancel')}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    );
}
