'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import PersonPicker, { type PersonPickerHandle } from '@/app/components/PersonPicker';
import { SegmentedControl, fieldClass } from '@/app/components/ui';
import { Avatar } from '@/app/components/ui/Avatar';
import { getDataClient } from '@/lib/data';
import { BookOpen, ChevronRight } from '@/lib/icons';
import { displayFullName } from '@/lib/utils/names';
import type { PersonResult } from '@/lib/db/schema';
import type { MediaOwnerFact, MediaOwnerTable } from '@/lib/db/fact-tables';

export interface DocumentLinkChoice {
    ownerTable: MediaOwnerTable;
    ownerId: number;
    ownerFact?: MediaOwnerFact;
}

interface SourceRow { Id: number; Title: string | null; Author?: string | null }

const ROW = 'flex items-center gap-3 w-full min-h-12 px-2 rounded-md text-left transition-colors hover:bg-surface-2 focus-ring disabled:opacity-50';

/**
 * Link a document to a person, one of their vital facts, or a source (#510).
 * The floating panel the face tagger's "Who is this?" uses, on phone and desktop:
 * pick Person or Source, then the record; a person then asks whether the
 * document is about them or about their birth or death, which is what puts it on
 * that fact's row on the person page.
 */
export default function LinkDocumentModal({ treeId, busy, onPick, onCancel }: {
    treeId: number | null;
    busy: boolean;
    onPick: (choice: DocumentLinkChoice) => void;
    onCancel: () => void;
}) {
    const t = useTranslations('documents');
    const tm = useTranslations('ownerMedia');
    const tc = useTranslations('common');
    const [kind, setKind] = useState<'person' | 'source'>('person');
    const [person, setPerson] = useState<PersonResult | null>(null);
    const [q, setQ] = useState('');
    const [sources, setSources] = useState<SourceRow[] | null>(null);
    const pickerRef = useRef<PersonPickerHandle>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const id = requestAnimationFrame(() => {
            if (kind === 'person' && !person) pickerRef.current?.focus();
            if (kind === 'source') searchRef.current?.focus();
        });
        return () => cancelAnimationFrame(id);
    }, [kind, person]);

    useEffect(() => {
        if (kind !== 'source') return;
        let live = true;
        const timer = setTimeout(async () => {
            try {
                const client = await getDataClient();
                const rows = q.trim()
                    ? await client.sources.search(q.trim(), treeId)
                    : (await client.sources.list({ treeId })).sources;
                if (live) setSources(rows);
            } catch {
                if (live) setSources([]);
            }
        }, q ? 200 : 0);
        return () => { live = false; clearTimeout(timer); };
    }, [kind, q, treeId]);

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key !== 'Escape') return;
            // Esc steps back from the fact choice before it closes the panel.
            e.stopPropagation();
            if (person) setPerson(null); else onCancel();
        }
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [person, onCancel]);

    const name = person ? displayFullName(person) || tc('unknown') : '';
    const factChoices: Array<{ fact?: MediaOwnerFact; label: string }> = [
        { label: t('link_whole_person', { name }) },
        { fact: 'Birth', label: tm('fact_birth') },
        { fact: 'Death', label: tm('fact_death') },
    ];

    return (
        <div
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            className="fixed inset-0 z-70 flex items-start justify-center md:items-center px-3"
            style={{ background: 'var(--color-lightbox-scrim)', paddingTop: 'max(env(safe-area-inset-top), 40px)' }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                data-testid="link-document-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="link-document-title"
                // eslint-disable-next-line no-restricted-syntax -- intentional modal-dialog surface (sized/positioned), not a content Card
                className="flex flex-col bg-card text-text rounded-xl shadow-xl overflow-hidden md:my-auto"
                style={{ width: 'min(440px, 100%)' }}
            >
                <div className="flex items-center gap-3 px-5 pt-4 pb-3 shrink-0">
                    <h3 id="link-document-title" className="title-dialog flex-1 min-w-0">{t('link_title')}</h3>
                    <button type="button" onClick={onCancel} disabled={busy}
                        className="text-base text-link font-medium px-1.5 min-h-11 shrink-0 rounded transition-opacity hover:opacity-80 disabled:opacity-50 focus-ring">
                        {tc('cancel')}
                    </button>
                </div>
                {!person && (
                    <div className="px-5 pb-3">
                        <SegmentedControl
                            fullWidth
                            aria-label={t('link_title')}
                            value={kind}
                            onChange={(v) => setKind(v === 'source' ? 'source' : 'person')}
                            options={[{ v: 'person', l: t('link_kind_person') }, { v: 'source', l: t('link_kind_source') }]}
                        />
                    </div>
                )}

                <div className="border-t border-border px-5 pt-3 pb-4 overflow-y-auto overscroll-contain max-h-[50dvh]">
                    {kind === 'person' && !person && (
                        <PersonPicker
                            ref={pickerRef}
                            inline
                            inlineResultsClassName=""
                            value={null}
                            onChange={(p) => { if (p) setPerson(p); }}
                            treeId={treeId}
                            showDates
                        />
                    )}
                    {kind === 'person' && person && (
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-3 pb-2">
                                <Avatar name={name} size={32} />
                                <span className="serif text-base font-semibold flex-1 min-w-0 truncate">{name}</span>
                                <button type="button" onClick={() => setPerson(null)} disabled={busy}
                                    className="text-sm text-link px-1.5 min-h-11 rounded focus-ring">{t('link_change_person')}</button>
                            </div>
                            <p className="m-0 pb-1 text-meta text-text-muted">{t('link_fact_prompt')}</p>
                            {factChoices.map((choice) => (
                                <button key={choice.fact ?? 'person'} type="button" disabled={busy} className={ROW}
                                    onClick={() => onPick({ ownerTable: 'People', ownerId: person.Id, ownerFact: choice.fact })}>
                                    <span className="flex-1 min-w-0 text-base">{choice.label}</span>
                                    <ChevronRight className="w-4 h-4 text-text-muted shrink-0" aria-hidden="true" />
                                </button>
                            ))}
                        </div>
                    )}
                    {kind === 'source' && (
                        <div className="flex flex-col gap-2">
                            <input ref={searchRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('link_search_sources')} aria-label={t('link_search_sources')}
                                className={fieldClass()} />
                            <div className="flex flex-col">
                                {sources?.map((s) => (
                                    <button key={s.Id} type="button" disabled={busy} className={ROW}
                                        onClick={() => onPick({ ownerTable: 'Sources', ownerId: s.Id })}>
                                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-surface-2 shrink-0"><BookOpen className="w-4 h-4" aria-hidden="true" /></span>
                                        <span className="flex-1 min-w-0">
                                            <span className="block truncate text-base">{s.Title || tc('unknown')}</span>
                                            {s.Author && <span className="block truncate text-meta text-text-muted">{s.Author}</span>}
                                        </span>
                                    </button>
                                ))}
                                {sources?.length === 0 && <p className="m-0 py-3 text-meta text-text-muted">{t('link_no_sources')}</p>}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
