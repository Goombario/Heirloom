import { leadStatus } from '@/lib/cases/lead-status';
import { displayFullName } from '@/lib/utils/names';
import type { CaseFinding, CaseWithRelations, CaseWorkspace, Media } from '@/lib/db/schema';

/**
 * Export the case (#58), as JSON with every record: the case, its people and
 * sources, its leads (with their worked-out status), findings with their claims
 * and decisions, requests and the whole journal, struck-out notes included. Records
 * point at one another by id. Files are named, not embedded; account emails are
 * left out. Built from what the page already holds, so it works the same hosted and
 * in the local app.
 */
export function caseExportJson(caseData: CaseWithRelations, workspace: CaseWorkspace, exportedAt = new Date()) {
    const file = (m: Media | null | undefined) => (m ? { id: m.Id, title: m.Title, date: m.Date ?? null, contentType: m.ContentType } : null);
    const person = (p: { Id: number; FirstName: string | null; LastName: string | null }) => ({ id: p.Id, name: displayFullName(p) || null });
    const finding = (f: CaseFinding) => ({
        id: f.Id,
        kind: f.Kind,
        leadIds: f.leadIds,
        addedAt: f.CreatedAt,
        source: f.citation ? {
            title: f.citation.sourceTitle,
            repository: f.citation.sourceRepo,
            page: f.citation.Page,
            url: f.citation.Url,
            transcription: f.citation.DataText,
        } : null,
        sourceNature: f.SourceNature,
        information: f.Information,
        searched: f.Searched,
        site: f.Site,
        note: f.Note,
        requestId: f.RequestId,
        file: file(f.media),
        claims: f.claims.map((c) => ({
            id: c.Id,
            what: c.What,
            personId: c.PersonId,
            person: c.personLabel ?? c.PersonName,
            says: c.Says,
            date: c.Date,
            place: c.Place,
            evidence: c.Evidence,
            decision: c.Decision,
            decidedAt: c.DecidedAt,
            appliedToTreeAt: c.AppliedAt,
        })),
    });

    return {
        format: 'heirloom-case',
        version: 1,
        exportedAt: exportedAt.toISOString(),
        case: {
            id: caseData.Id,
            question: caseData.Title,
            background: caseData.Description,
            questionKind: caseData.QuestionKind ?? null,
            status: caseData.Status,
            outcome: caseData.Outcome ?? null,
            fromYear: caseData.FromYear ?? null,
            toYear: caseData.ToYear ?? null,
            place: caseData.Place ?? null,
            tags: caseData.Tags,
            openedAt: caseData.CreatedAt,
            updatedAt: caseData.UpdatedAt,
            closedAt: caseData.ClosedAt ?? null,
        },
        people: caseData.people.map(person),
        sources: caseData.citations.map((c) => ({
            title: c.sourceTitle,
            repository: c.sourceRepo,
            page: c.Page,
            url: c.Url ?? c.sourceUrl,
            transcription: c.DataText,
            note: c.Note,
        })),
        photos: caseData.media.map(file),
        leads: workspace.leads.map((l) => ({
            id: l.Id,
            question: l.Question,
            fromYear: l.FromYear,
            toYear: l.ToYear,
            status: l.DroppedAt != null ? 'dropped' : leadStatus(l, workspace.findings, workspace.requests),
            addedAt: l.CreatedAt,
            settledAt: l.SettledAt,
            droppedAt: l.DroppedAt,
            people: l.people.map(person),
        })),
        findings: workspace.findings.map(finding),
        requests: workspace.requests.map((r) => ({
            id: r.Id,
            leadId: r.LeadId,
            askedFor: r.AskedFor,
            holder: r.Holder,
            sentBy: r.SentBy,
            sentOn: r.SentOn,
            reference: r.Reference,
            remindOn: r.RemindOn,
            state: r.State,
            repliedAt: r.RepliedAt,
            replyNote: r.ReplyNote,
            askedAt: r.CreatedAt,
        })),
        journal: caseData.comments.map((c) => ({
            id: c.Id,
            kind: c.Kind ?? 'note',
            body: c.Body,
            at: c.CreatedAt,
            by: c.UserName ?? null,
            leadIds: c.leadIds ?? [],
            findingId: c.FindingId ?? null,
            requestId: c.RequestId ?? null,
            file: file(c.media),
            cites: c.citationLabel ?? null,
            struckAt: c.StruckAt ?? null,
            struckBy: c.StruckByName ?? null,
            struckReason: c.StruckReason ?? null,
        })),
    };
}

/** A file name from the case's question: `case-12-where-did-anna-go.json`. */
export function caseExportName(caseData: Pick<CaseWithRelations, 'Id' | 'Title'>, ext: string): string {
    const slug = caseData.Title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
    return `case-${caseData.Id}${slug ? `-${slug}` : ''}${ext ? `.${ext}` : ''}`;
}

/** Saves a blob through a download link. */
export function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking at once can cancel the download before the browser reads it.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
