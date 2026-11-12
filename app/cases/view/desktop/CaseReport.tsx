'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { displayFullName } from '@/lib/utils/names';
import type { CaseFinding, CaseWithRelations, CaseWorkspace } from '@/lib/db/schema';
import { loggedEntryText } from '../case-detail-helpers';
import { claimWhat } from './claims';
import { yearsLabel } from './LeadsRail';
import type { LeadSummary } from './useCaseWorkspace';

/**
 * The case to read (#58), laid out for print so Export saves it as a PDF: the
 * question, scope and people, the answer when closed, each lead with its records,
 * claims and decisions, nothing-found searches and requests, then the journal.
 * Only shown while printing.
 */
export function CaseReport({ caseData, workspace, summaries }: {
    caseData: CaseWithRelations;
    workspace: CaseWorkspace;
    summaries: LeadSummary[];
}) {
    const t = useTranslations('caseResearch');
    const tCases = useTranslations('cases');
    const format = useFormatter();
    const day = (iso: string | null | undefined) => (iso ? format.dateTime(new Date(iso), { dateStyle: 'medium' }) : '');
    const names = (people: Array<{ Id: number; FirstName: string | null; LastName: string | null }>) => people.map((p) => displayFullName(p) || t('unnamed')).join(', ');
    // The answer is the last conclusion while the case is closed; a reopened case has none yet.
    const conclusion = caseData.Status === 'closed' ? [...caseData.comments].reverse().find((c) => c.Kind === 'conclusion')?.Body ?? '' : '';
    const scope = [yearsLabel(caseData.FromYear ?? null, caseData.ToYear ?? null), caseData.Place].filter(Boolean).join(' · ');
    const status = caseData.Status === 'closed'
        ? caseData.Outcome ? t('closed_outcome', { outcome: t(`outcome_${caseData.Outcome}`), date: day(caseData.ClosedAt ?? caseData.UpdatedAt) }) : t('closed_on', { date: day(caseData.ClosedAt ?? caseData.UpdatedAt) })
        : null;
    const unfiled = workspace.findings.filter((f) => f.leadIds.length === 0);

    const record = (f: CaseFinding) => {
        if (f.Kind === 'nothing') {
            return (
                <li key={f.Id}>
                    {t('nothing_found_in', { searched: f.Searched ?? '' })}
                    {[f.Site, f.Note].filter(Boolean).length > 0 && <> · {[f.Site, f.Note].filter(Boolean).join(' · ')}</>}
                    <span className="case-print-muted"> · {day(f.CreatedAt)}</span>
                </li>
            );
        }
        const where = [f.citation?.sourceRepo, f.citation?.Page, f.citation?.Url].filter(Boolean).join(' · ');
        return (
            <li key={f.Id}>
                <strong>{f.citation?.sourceTitle || t('untitled_record')}</strong>
                <span className="case-print-muted"> · {day(f.CreatedAt)}</span>
                {where && <div className="case-print-muted">{where}</div>}
                {f.citation?.DataText && <blockquote>{f.citation.DataText}</blockquote>}
                {f.claims.length === 0 ? (
                    <div className="case-print-muted">{t('no_claims_yet')}</div>
                ) : (
                    <table>
                        <tbody>
                            {f.claims.map((c) => (
                                <tr key={c.Id}>
                                    <td>{claimWhat(c.What, t)}</td>
                                    <td>{[[c.Says, c.Date, c.Place].filter(Boolean).join(', '), c.personLabel || c.PersonName].filter(Boolean).join(' · ') || t('says_nothing')}</td>
                                    <td>{t(`report_decision_${c.Decision}`)}{c.AppliedAt && ` · ${t('report_applied')}`}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </li>
        );
    };

    return (
        <article className="case-print-report">
            <p className="case-print-muted">{t('report_eyebrow')}</p>
            <h1>{caseData.Title}</h1>
            <p className="case-print-muted">
                {[status, t('report_opened', { date: day(caseData.CreatedAt) }), t('report_exported', { date: day(new Date().toISOString()) })].filter(Boolean).join(' · ')}
            </p>
            <dl>
                {caseData.people.length > 0 && <><dt>{t('people')}</dt><dd>{names(caseData.people)}</dd></>}
                {scope && <><dt>{t('scope')}</dt><dd>{scope}</dd></>}
                {caseData.Description && <><dt>{t('report_background')}</dt><dd>{caseData.Description}</dd></>}
                {caseData.Tags.length > 0 && <><dt>{t('report_tags')}</dt><dd>{caseData.Tags.join(', ')}</dd></>}
            </dl>

            {conclusion && (
                <section>
                    <h2>{t('the_answer')}</h2>
                    <p className="case-print-body">{conclusion}</p>
                </section>
            )}

            {summaries.map(({ lead, status: leadStatus }) => {
                const mine = workspace.findings.filter((f) => f.leadIds.includes(lead.Id));
                const asked = workspace.requests.filter((r) => r.LeadId === lead.Id);
                const years = yearsLabel(lead.FromYear, lead.ToYear);
                return (
                    <section key={lead.Id}>
                        <h2>{lead.Question}</h2>
                        <p className="case-print-muted">
                            {[t(`status_${leadStatus}`), years, lead.people.length > 0 && names(lead.people)].filter(Boolean).join(' · ')}
                        </p>
                        {mine.length === 0 ? <p className="case-print-muted">{t('no_findings')}</p> : <ul>{mine.map(record)}</ul>}
                        {asked.length > 0 && (
                            <>
                                <h3>{t('report_requests')}</h3>
                                <ul>
                                    {asked.map((r) => (
                                        <li key={r.Id}>
                                            {[r.AskedFor, r.Holder, r.Reference && t('their_reference', { reference: r.Reference }), t(`report_request_${r.State}`), r.ReplyNote].filter(Boolean).join(' · ')}
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </section>
                );
            })}

            {unfiled.length > 0 && (
                <section>
                    <h2>{t('report_whole_case')}</h2>
                    <ul>{unfiled.map(record)}</ul>
                </section>
            )}

            {caseData.comments.length > 0 && (
                <section>
                    <h2>{t('journal')}</h2>
                    <ul>
                        {caseData.comments.map((c) => (
                            <li key={c.Id} className={c.StruckAt ? 'case-print-struck' : undefined}>
                                <span className="case-print-muted">{format.dateTime(new Date(c.CreatedAt), { dateStyle: 'medium', timeStyle: 'short' })}{c.UserName && ` · ${c.UserName}`} · </span>
                                {c.Kind === 'conclusion' && <strong>{tCases('journal_conclusion')}: </strong>}
                                <span className="case-print-body">{loggedEntryText(c, tCases) ?? c.Body}</span>
                                {c.citationLabel && <span className="case-print-muted"> · {c.citationLabel}</span>}
                                {c.StruckAt && <div className="case-print-muted">{[c.StruckByName ? tCases('journal_struck_by', { name: c.StruckByName, date: day(c.StruckAt) }) : tCases('journal_struck', { date: day(c.StruckAt) }), c.StruckReason].filter(Boolean).join(' · ')}</div>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </article>
    );
}
