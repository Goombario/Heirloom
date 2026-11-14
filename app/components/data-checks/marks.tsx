'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, Button, Card, WarningDot } from '@/app/components/ui';
import type { TimelineItem } from '@/app/components/Timeline';
import { useTree } from '@/app/contexts/TreeContext';
import { useDataCheckText } from '@/app/data-checks/useDataCheckText';
import { ChevronRight, Pencil } from '@/lib/icons';
import { getDataClient } from '@/lib/data';
import type { DataCheckEntry, DataChecksFilter, DataChecksResult } from '@/lib/data/types';

type DataCheckText = ReturnType<typeof useDataCheckText>;

const NO_PEOPLE: DataChecksResult['people'] = [];

export interface DataCheckMarks {
    /** Problems still to check: confirmed unlikely ones get no mark (#833). */
    open: DataCheckEntry[];
    /** Each fact key to fix, with the open problems that would have you fix it. */
    byFact: Map<string, DataCheckEntry[]>;
    text: DataCheckText;
}

/**
 * One person's or one family's open problems, for the marks on their page
 * (#833). Fetched once `reloadKey` (the loaded record) is set and again when it
 * changes, so an edit on the page that fixes a date clears its mark.
 * Best-effort: a failure just shows no marks.
 */
export function useDataCheckMarks(filter: DataChecksFilter, reloadKey: unknown): DataCheckMarks {
    const { activeTreeId } = useTree();
    const [result, setResult] = useState<DataChecksResult | null>(null);
    const { personId, familyId } = filter;
    // By content, not identity: the page's background revalidation hands back an
    // equal record, and asking again would check the whole tree a second time (#66).
    const signature = useMemo(() => (reloadKey == null ? null : JSON.stringify(reloadKey)), [reloadKey]);
    useEffect(() => {
        // Never the whole tree's list: a page asks for its own person or family.
        if (personId == null && familyId == null) return;
        // Not before the record itself has loaded: the answer would be asked for
        // again the moment it does, and each ask checks the whole tree (#1270).
        if (signature == null) return;
        let cancelled = false;
        (async () => {
            try {
                const client = await getDataClient();
                const next = await client.dataChecks.list(activeTreeId, { personId, familyId });
                if (!cancelled) setResult(next);
            } catch {
                // Marks are supplementary; the page works without them.
            }
        })();
        return () => { cancelled = true; };
    }, [activeTreeId, personId, familyId, signature]);

    const text = useDataCheckText(result?.people ?? NO_PEOPLE);
    return useMemo(() => {
        const open = (result?.problems ?? []).filter((p) => !p.confirmation);
        const byFact = new Map<string, DataCheckEntry[]>();
        for (const p of open) {
            for (const key of p.editable) {
                const list = byFact.get(key);
                if (list) list.push(p); else byFact.set(key, [p]);
            }
        }
        return { open, byFact, text };
    }, [result, text]);
}

/**
 * The marks on a timeline (#833): only the row of a date to fix gets one, as a
 * warning tint and an always-visible "Check this date" button on the title
 * line. The button discloses a panel under the row with the problem, "Edit
 * date" (the row's own inline editor) and a link to the entry in Data checks.
 * One panel is open at a time; Escape closes it and returns focus to its button.
 *
 * Returns a function that gives a row its `flagged`, `mark` and `callout`.
 */
export function useTimelineMarks(marks: DataCheckMarks | undefined, { dataChecksLink = true }: { dataChecksLink?: boolean } = {}) {
    const [open, setOpen] = useState<string | null>(null);
    const buttons = useRef(new Map<string, HTMLButtonElement>());
    const idPrefix = useId();

    const close = (factKey: string) => {
        setOpen(null);
        buttons.current.get(factKey)?.focus();
    };

    return (factKey: string, onEdit?: () => void): Pick<TimelineItem, 'flagged' | 'mark' | 'callout'> => {
        const entries = marks?.byFact.get(factKey);
        if (!marks || !entries?.length) return {};
        const expanded = open === factKey;
        const id = `${idPrefix}dc-${factKey}`;
        return {
            flagged: true,
            mark: (
                <MarkButton entries={entries} text={marks.text} expanded={expanded} controls={id}
                    buttonRef={(el) => { if (el) buttons.current.set(factKey, el); else buttons.current.delete(factKey); }}
                    onToggle={() => setOpen(expanded ? null : factKey)} onClose={() => close(factKey)} />
            ),
            callout: expanded ? (
                <Callout id={id} entries={entries} text={marks.text} link={dataChecksLink} onClose={() => close(factKey)}
                    // Focus the mark first, so the row's editor returns focus to it on close.
                    onEdit={onEdit && (() => { buttons.current.get(factKey)?.focus(); setOpen(null); onEdit(); })} />
            ) : null,
        };
    };
}

function MarkButton({ entries, text, expanded, controls, buttonRef, onToggle, onClose }: {
    entries: DataCheckEntry[]; text: DataCheckText; expanded: boolean; controls: string;
    buttonRef: (el: HTMLButtonElement | null) => void; onToggle: () => void; onClose: () => void;
}) {
    const t = useTranslations('dataChecks');
    return (
        <button type="button" ref={buttonRef} onClick={onToggle} aria-expanded={expanded} aria-controls={controls}
            onKeyDown={(e) => { if (e.key === 'Escape' && expanded) { e.preventDefault(); e.stopPropagation(); onClose(); } }}
            aria-label={t('mark_named', { sentence: text.sentence(entries[0]) })}
            className="inline-flex items-center gap-1.5 min-h-[26px] rounded-lg border border-warning-edge bg-card aria-expanded:bg-warning-bg text-warning-text py-0.5 pl-[5px] pr-[9px] text-meta font-semibold whitespace-nowrap cursor-pointer focus-ring">
            <WarningDot />
            {t('mark_label')}
        </button>
    );
}

function Callout({ id, entries, text, link, onEdit, onClose }: {
    id: string; entries: DataCheckEntry[]; text: DataCheckText; link: boolean; onEdit?: () => void; onClose: () => void;
}) {
    const t = useTranslations('dataChecks');
    return (
        <Card id={id} role="group" aria-label={t('mark_label')} pad={false}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
            className="grid gap-2 !border-warning-border px-3.5 py-3 text-sm">
            {entries.map((e) => (
                <div key={e.id} className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2 text-meta text-text-muted">
                        <Badge tone={e.kind === 'impossible' ? 'warning' : 'neutral'}>{t(`kind_${e.kind}`)}</Badge>
                        <span>{text.ruleName(e.rule)}</span>
                    </div>
                    <p className="m-0 font-semibold text-text">{text.sentence(e)}</p>
                </div>
            ))}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {onEdit && (
                    <Button variant="outline" size="sm" onClick={onEdit}>
                        <Pencil className="w-4 h-4" aria-hidden="true" />{t('edit_date')}
                    </Button>
                )}
                {link && (
                    <Link href={`/data-checks?entry=${encodeURIComponent(entries[0].id)}`}
                        className="inline-flex items-center gap-0.5 min-h-6 text-sm text-link hover:underline">
                        {t('open_in_data_checks')}
                        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </Link>
                )}
            </div>
        </Card>
    );
}
