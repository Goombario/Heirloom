'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getDataClient } from '@/lib/data';
import { leadStatus, undecidedOnLead, type LeadStatus } from '@/lib/cases/lead-status';
import type { CaseLead, CaseWorkspace } from '@/lib/db/schema';
import type { CaseWorkspaceWrite } from '@/lib/data/types';

/** The case's own pages: All evidence, Answer and close, and a closed case's answer. */
type CasePage = 'evidence' | 'close' | 'answer';
const CASE_PAGES: readonly string[] = ['evidence', 'close', 'answer'];

/** What the main column shows: a lead, or a page of the case. */
export type WorkspaceView = { kind: 'lead'; leadId: number } | { kind: CasePage };

const VIEW_EVENT = 'heirloom:case-view';

function readView(): string {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return params.get('lead') ?? params.get('page') ?? '';
}

function subscribe(onChange: () => void) {
    window.addEventListener('popstate', onChange);
    window.addEventListener(VIEW_EVENT, onChange);
    return () => {
        window.removeEventListener('popstate', onChange);
        window.removeEventListener(VIEW_EVENT, onChange);
    };
}

/** The open lead or page lives in the address (`?id=…&lead=12`, `&page=evidence`), so Back and a shared link return to it. */
function writeView(view: WorkspaceView) {
    const url = new URL(window.location.href);
    url.searchParams.delete('lead');
    url.searchParams.delete('page');
    if (view.kind === 'lead') url.searchParams.set('lead', String(view.leadId));
    else url.searchParams.set('page', view.kind);
    window.history.pushState(window.history.state, '', url);
    window.dispatchEvent(new Event(VIEW_EVENT));
}

export interface LeadSummary {
    lead: CaseLead;
    status: LeadStatus;
    undecided: number;
}

/**
 * The research workspace's data (#58): the case's leads, findings and requests,
 * the open lead or page, and the writes. Each write answers with the whole
 * workspace, so the page redraws from that one answer.
 */
export function useCaseWorkspace(caseId: number, treeId: number | null, refreshKey: unknown, closed = false) {
    const [workspace, setWorkspace] = useState<CaseWorkspace | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const generation = useRef(0);
    const raw = useSyncExternalStore(subscribe, readView, () => '');

    const load = useCallback(async () => {
        const mine = ++generation.current;
        try {
            const client = await getDataClient();
            const ws = await client.cases.getWorkspace(caseId, treeId);
            if (mine === generation.current) { setWorkspace(ws); setError(null); }
        } catch (err) {
            if (mine === generation.current) setError(err instanceof Error ? err.message : String(err));
        }
    }, [caseId, treeId]);

    // The journal or the case changing (refreshKey) reloads too: a note can file under a lead.
    useEffect(() => { void load(); }, [load, refreshKey]);

    /** Runs a write and takes its workspace; resolves the new row's id, or null when it failed (`error` says why). */
    const run = useCallback(async (write: () => Promise<CaseWorkspaceWrite>): Promise<number | null | false> => {
        setBusy(true);
        try {
            const result = await write();
            generation.current++;
            setWorkspace(result.workspace);
            setError(null);
            return result.id;
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            return false;
        } finally {
            setBusy(false);
        }
    }, []);

    const summaries = useMemo<LeadSummary[]>(() => {
        if (!workspace) return [];
        return workspace.leads
            .filter((l) => l.DroppedAt == null)
            .map((lead) => ({
                lead,
                status: leadStatus(lead, workspace.findings, workspace.requests),
                undecided: undecidedOnLead(lead.Id, workspace.findings),
            }));
    }, [workspace]);

    // The open lead or page: the address's, else a closed case's answer, else the first lead in play.
    // Answer and close is only for an open case, and the answer only for a closed one.
    const view = useMemo<WorkspaceView | null>(() => {
        if (CASE_PAGES.includes(raw) && (raw === 'evidence' || (raw === 'answer') === closed)) return { kind: raw as CasePage };
        const asked = Number(raw);
        if (raw !== '' && Number.isInteger(asked) && summaries.some((s) => s.lead.Id === asked)) return { kind: 'lead', leadId: asked };
        if (closed) return { kind: 'answer' };
        return summaries[0] ? { kind: 'lead', leadId: summaries[0].lead.Id } : null;
    }, [raw, summaries, closed]);

    /** The new sources the case found, across every lead: what All evidence counts. */
    const evidenceCount = useMemo(() => {
        if (!workspace) return 0;
        const sources = new Set<number>();
        let nothing = 0;
        for (const f of workspace.findings) {
            if (f.citation) sources.add(f.citation.SourceId);
            else if (f.Kind === 'nothing') nothing++;
        }
        return sources.size + nothing;
    }, [workspace]);

    return {
        workspace, error, setError, busy, summaries, view, evidenceCount,
        open: writeView,
        reload: load,
        run,
    };
}

