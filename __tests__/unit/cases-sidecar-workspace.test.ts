import { describe, it, expect } from 'vitest';
import { parseCaseScope, parseCaseWorkspace, parseCommentLinks } from '@/lib/gedcom/cases-sidecar';

/** A hostile or corrupt cases.json workspace is dropped piece by piece, never fatal (#58, ADR 0045 §9). */
describe('parseCaseWorkspace', () => {
    it('keeps each entry at its index and drops what is malformed', () => {
        const ws = parseCaseWorkspace({
            leads: [{ Question: 'Find Ada' }, { Question: '' }, 'junk', { Question: 'Years', FromYear: 1900, ToYear: 1850 }],
            requests: [
                { AskedFor: 'Baptism', lead: 0, SentOn: '2023-02-31', RemindOn: '2023-03-01', State: 'bogus', CreatedAt: '-271821-04-20T00:00:00Z' },
                { AskedFor: 'Burial', lead: 99 },
            ],
            findings: [
                { Kind: 'record', leads: [0, 1, 7, -1, 'x'], request: 1, media: '@O1@', citation: { source: '@S1@', page: 'p\u0000. 4' },
                    claims: [{ What: 'BIRT', Decision: 'maybe' }, { What: '' }, null] },
                { Kind: 'nothing' },
                { Kind: 'nothing', Searched: '1871 census', media: '@O2@' },
                { Kind: 'other' },
            ],
        });
        expect(ws.leads).toEqual([
            expect.objectContaining({ Question: 'Find Ada' }), null, null,
            expect.objectContaining({ Question: 'Years', FromYear: null, ToYear: null }),
        ]);
        expect(ws.requests[0]).toMatchObject({ lead: 0, SentOn: null, RemindOn: '2023-03-01', State: 'waiting', CreatedAt: null });
        expect(ws.requests[1]).toMatchObject({ lead: null });
        expect(ws.findings[0]).toMatchObject({ leads: [0, 1], request: 1, citation: { source: '@S1@', page: 'p. 4' } });
        expect(ws.findings[0]!.claims).toEqual([expect.objectContaining({ What: 'BIRT', Decision: 'undecided' })]);
        expect(ws.findings[1]).toBeNull();
        expect(ws.findings[2]).toMatchObject({ Kind: 'nothing', media: null, claims: [] });
        expect(ws.findings[3]).toBeNull();
        expect(parseCommentLinks({ leads: [3, 4], finding: 2, request: 5 }, ws)).toEqual({ leads: [3], finding: 2, request: null });
    });

    it('reads nothing from a case without a workspace, and checks the scope', () => {
        expect(parseCaseWorkspace({ Title: 'Old' })).toEqual({ leads: [], requests: [], findings: [] });
        expect(parseCaseScope({ FromYear: 1850.5, ToYear: 1900, QuestionKind: 'Robert); DROP', Outcome: 'answered', ClosedAt: 'nope' }))
            .toEqual({ FromYear: null, ToYear: 1900, Place: null, QuestionKind: null, Outcome: 'answered', ClosedAt: null });
    });
});
