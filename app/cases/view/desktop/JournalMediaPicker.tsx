'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import MediaImg from '@/app/components/MediaImg';
import { Button, FormDialog, ScrollArea } from '@/app/components/ui';
import { getDataClient } from '@/lib/data';
import type { Media } from '@/lib/db/schema';

/** Where the journal's Attach menu picks from (#34). */
export type JournalMediaScope = 'case' | 'people';

/**
 * Attach › From this case's media / From the case's people's media (#34): pick one
 * item the tree already holds for the entry, with no upload and no duplicate file.
 * The case's people's items exclude what the case already has.
 */
export function JournalMediaPicker({ scope, caseId, caseMedia, treeId, onPick, onClose }: {
    scope: JournalMediaScope;
    caseId: number;
    caseMedia: Media[];
    treeId: number | null;
    onPick: (media: Media) => void;
    onClose: () => void;
}) {
    const t = useTranslations('caseResearch');
    const tc = useTranslations('common');
    const [loaded, setLoaded] = useState<{ items: Media[] } | { error: true } | null>(scope === 'case' ? { items: caseMedia } : null);

    useEffect(() => {
        if (scope !== 'people') return;
        let cancelled = false;
        (async () => {
            try {
                const all = await (await getDataClient()).cases.listMediaLibrary(caseId, treeId);
                const have = new Set(caseMedia.map((m) => m.Id));
                if (!cancelled) setLoaded({ items: all.filter((m) => !have.has(m.Id)) });
            } catch {
                if (!cancelled) setLoaded({ error: true });
            }
        })();
        return () => { cancelled = true; };
    }, [scope, caseId, caseMedia, treeId]);

    const items = loaded && 'items' in loaded ? loaded.items : null;

    return (
        <FormDialog
            open
            onClose={onClose}
            title={scope === 'case' ? t('attach_from_case') : t('attach_from_people')}
            footer={<Button variant="outline" onClick={onClose}>{tc('cancel')}</Button>}
        >
            {loaded == null ? (
                <p role="status" className="m-0 text-sm text-text-muted">{tc('loading')}</p>
            ) : 'error' in loaded ? (
                <p role="alert" className="m-0 text-sm text-error">{t('attach_load_failed')}</p>
            ) : items!.length === 0 ? (
                <p className="m-0 text-sm text-text-muted">{scope === 'case' ? t('attach_none_case') : t('attach_none_people')}</p>
            ) : (
                <ScrollArea className="max-h-[60vh]">
                    <ul className="m-0 p-0 list-none grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                        {items!.map((m) => (
                            <li key={m.Id}>
                                <button type="button" onClick={() => onPick(m)}
                                    className="grid w-full gap-1.5 rounded-md border border-border bg-transparent p-2 text-left cursor-pointer hover:bg-hover-surface focus-ring">
                                    <MediaImg mediaId={m.Id} contentType={m.ContentType} treeId={treeId} width={280} alt=""
                                        className="block w-full aspect-[4/3] object-cover rounded-md bg-surface-2" />
                                    <span className="truncate text-meta text-text">{m.Title || t('photo')}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </ScrollArea>
            )}
        </FormDialog>
    );
}
