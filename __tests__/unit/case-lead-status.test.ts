import { describe, it, expect } from 'vitest';
import { leadStatus, undecidedOnLead } from '@/lib/cases/lead-status';
import type { CaseClaim } from '@/lib/db/schema';

/** A lead's status is worked out from its findings and requests, never stored (#58, ADR 0045). */
describe('leadStatus', () => {
    const lead = { Id: 1, SettledAt: null };
    const claim = (Decision: CaseClaim['Decision']) => ({ Decision }) as CaseClaim;

    it('is To search with no findings', () => {
        expect(leadStatus(lead, [{ leadIds: [2] }], [])).toBe('to_search');
    });

    it('is In progress once a finding is filed under it', () => {
        expect(leadStatus(lead, [{ leadIds: [2, 1] }], [{ LeadId: 1, State: 'received' }])).toBe('in_progress');
    });

    it('is Waiting while one of its requests is waiting, findings or not', () => {
        expect(leadStatus(lead, [{ leadIds: [1] }], [{ LeadId: 1, State: 'waiting' }])).toBe('waiting');
        expect(leadStatus(lead, [], [{ LeadId: 2, State: 'waiting' }])).toBe('to_search');
    });

    it('is Settled once settled, whatever else it has', () => {
        expect(leadStatus({ Id: 1, SettledAt: '2026-11-12T00:00:00Z' }, [], [{ LeadId: 1, State: 'waiting' }])).toBe('settled');
    });

    it('counts the undecided claims on findings filed under the lead', () => {
        const findings = [
            { leadIds: [1], claims: [claim('undecided'), claim('accepted')] },
            { leadIds: [1, 2], claims: [claim('undecided')] },
            { leadIds: [2], claims: [claim('undecided')] },
        ];
        expect(undecidedOnLead(1, findings)).toBe(2);
        expect(undecidedOnLead(3, findings)).toBe(0);
    });
});
