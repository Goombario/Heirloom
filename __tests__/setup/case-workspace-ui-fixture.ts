import type { CaseClaim, CaseFinding, CaseLead, CaseRequest } from '@/lib/db/schema';
import type { LeadSummary } from '@/app/cases/view/desktop/useCaseWorkspace';

/** A lead with two records that agree and one that conflicts, a search that found nothing and a request out (#58). */
const claim = (id: number, findingId: number, over: Partial<CaseClaim>): CaseClaim => ({
    Id: id, FindingId: findingId, Position: 0, What: 'BIRT', PersonId: 7, PersonName: null, personLabel: 'Anna Kowalski',
    Says: null, Date: '12 Mar 1882', Place: 'Kraków', Evidence: 'direct', Decision: 'undecided', DecidedAt: null, AppliedAt: null, ...over,
});

const finding = (id: number, over: Partial<CaseFinding>): CaseFinding => ({
    Id: id, CaseId: 1, Kind: 'record', UserId: 1, CreatedAt: '2026-11-10T12:00:00Z', MediaId: null, media: null,
    SourceNature: 'original', Information: 'primary', Searched: null, Site: null, Note: null, RequestId: null,
    citation: null, leadIds: [11], claims: [], ...over,
});

export const lead: CaseLead = {
    Id: 11, CaseId: 1, Question: 'Find her baptism in the parish books', FromYear: 1880, ToYear: 1886, Position: 0,
    CreatedAt: '2026-11-01T12:00:00Z', SettledAt: null, DroppedAt: null,
    people: [{ Id: 7, FirstName: 'Anna', LastName: 'Kowalski', Sex: 'F' }],
};

export const findings: CaseFinding[] = [
    finding(21, {
        citation: { Id: 1, SourceId: 1, sourceTitle: 'St Mary parish register, baptisms 1880–1890', sourceRepo: 'Kraków diocesan archive', Page: 'p. 41, entry 112', Url: null, DataText: null },
        claims: [claim(31, 21, { Decision: 'accepted', DecidedAt: '2026-11-10T12:00:00Z' }), claim(32, 21, { What: 'PARENTS', Date: null, Place: null, Says: 'Jan Kowalski and Maria Nowak' })],
    }),
    finding(22, {
        CreatedAt: '2026-11-11T12:00:00Z', leadIds: [11, 12],
        citation: { Id: 2, SourceId: 2, sourceTitle: '1900 census, Duluth ward 3', sourceRepo: null, Page: 'sheet 7', Url: null, DataText: null },
        claims: [claim(33, 22, { Date: 'Mar 1883', Place: 'Austria' })],
    }),
    finding(23, { Kind: 'nothing', Searched: 'St Florian baptisms 1880–1886', Site: 'Metryki', CreatedAt: '2026-11-09T12:00:00Z' }),
];

export const requests: CaseRequest[] = [{
    Id: 41, CaseId: 1, LeadId: 11, AskedFor: 'Baptism certificate', Holder: 'Kraków diocesan archive', SentBy: 'email',
    SentOn: '2026-11-05', Reference: 'KR-2291', RemindOn: '2026-12-05', State: 'waiting', RepliedAt: null, ReplyNote: null, CreatedAt: '2026-11-05T12:00:00Z',
}];

export const summary: LeadSummary = { lead, status: 'in_progress', undecided: 2 };
