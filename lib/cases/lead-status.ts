import type { CaseFinding, CaseLead, CaseRequest } from '@/lib/db/schema';

export type LeadStatus = 'to_search' | 'in_progress' | 'waiting' | 'settled';

/**
 * A lead's status, worked out from its rows and never stored (#58, ADR 0045):
 * Settled once settled; Waiting while one of its requests is still waiting; To
 * search with no findings; In progress otherwise.
 */
export function leadStatus(lead: Pick<CaseLead, 'Id' | 'SettledAt'>, findings: readonly Pick<CaseFinding, 'leadIds'>[], requests: readonly Pick<CaseRequest, 'LeadId' | 'State'>[]): LeadStatus {
    if (lead.SettledAt) return 'settled';
    if (requests.some((r) => r.LeadId === lead.Id && r.State === 'waiting')) return 'waiting';
    return findings.some((f) => f.leadIds.includes(lead.Id)) ? 'in_progress' : 'to_search';
}

/** The undecided claims on a lead's findings: Settle lead waits until there are none. */
export function undecidedOnLead(leadId: number, findings: readonly Pick<CaseFinding, 'leadIds' | 'claims'>[]): number {
    let count = 0;
    for (const f of findings) {
        if (!f.leadIds.includes(leadId)) continue;
        for (const c of f.claims) if (c.Decision === 'undecided') count++;
    }
    return count;
}
