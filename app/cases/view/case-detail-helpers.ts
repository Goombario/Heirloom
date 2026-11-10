import type { CaseCitation, CaseComment, CaseWithRelations, PersonResult } from '@/lib/db/schema';
import type { Citation } from '@/lib/db/queries/citations';
import { FACT_TABLES } from '@/lib/db/fact-tables';

/**
 * Pure helpers extracted from CaseDetailView during the logic-first
 * decomposition (see docs/superpowers/_archive/plans/2026-07-01-cases-redesign-plan.md).
 * Behaviour must match the original inline implementations exactly.
 */

/**
 * Map a case's linked-people rows into the PersonResult shape PersonPicker
 * expects. Birth/death dates are not carried on case people, so they are null.
 */
export function toPersonResults(people: CaseWithRelations['people']): PersonResult[] {
    return people.map(p => ({
        Id: p.Id,
        FirstName: p.FirstName,
        LastName: p.LastName,
        EffectiveFirstName: p.EffectiveFirstName,
        Nickname: p.Nickname,
        Sex: p.Sex ?? null,
        BirthDate: null,
        DeathDate: null,
        PrimaryMediaId: p.PrimaryMediaId,
        FocalX: p.FocalX,
        FocalY: p.FocalY,
        FocalRadius: p.FocalRadius ?? null,
    }));
}

/**
 * The journal entries a researcher wrote: notes and the closing conclusion, not
 * the status lines the app logs (#801). Counts and "has an entry" checks use it.
 */
export function writtenEntries(comments: CaseComment[]): CaseComment[] {
    return comments.filter(c => c.Kind !== 'status');
}

/** A case-level citation in the shape the shared CitationPreview reads (#918). */
export function caseCitationAsCitation(c: CaseCitation): Citation {
    return {
        Id: c.Id, OwnerId: 0, FactTable: FACT_TABLES.CASES, FactId: c.CaseId, SourceId: c.SourceId,
        Page: c.Page, Note: c.Note, Quay: c.Quay, DataText: c.DataText, Url: c.Url,
        DataDate: null, Even: null, Role: null, CreatedAt: '',
        sourceTitle: c.sourceTitle, sourceType: c.sourceType, sourceRepo: c.sourceRepo,
    };
}
