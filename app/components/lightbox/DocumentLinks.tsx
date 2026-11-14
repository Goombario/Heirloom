'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { DATA_MODE, getDataClient } from '@/lib/data';
import { mediaFileUrl } from '@/lib/media-url';
import { ArrowUpRight, BookOpen, ChevronRight, X } from '@/lib/icons';
import { Avatar } from '@/app/components/ui/Avatar';
import { PhotoDateText } from '@/app/components/media/PhotoDateText';
import { librarySourceHref } from '@/app/library/links';
import { eventTypeLabel } from '@/lib/places/eventTypes';
import { displayFullName } from '@/lib/utils/names';
import type { MediaLinkOwner } from '@/lib/db/schema';

/**
 * What a document's rail and Details sheet show in place of a photo's face tags
 * (#510): the records it is linked to, the way to link more, and the file itself.
 */
export interface DocumentRail {
    /** "PDF · 2 pages · 1.2 MB", or as much of it as is known. */
    meta: string;
    /** Null while the links load. */
    links: MediaLinkOwner[] | null;
    onLink: () => void;
    onUnlink: (owner: MediaLinkOwner) => void;
    /** The file to open in a new tab or the phone's viewer; null while a local blob loads. */
    fileHref: string | null;
    /** The same file sent as a download. */
    downloadHref: string | null;
    /** The download's file name, which a local blob URL doesn't carry. */
    downloadName: string;
}

/**
 * Where to open and download a document. Hosted: the file route, with
 * `download=1` for an attachment. Local: one blob URL for both, read only when
 * `enabled`, so a photo in the same viewer never reads its full file for this.
 */
export function useDocumentFile(mediaId: number | undefined, treeId: number | null, enabled: boolean): {
    fileHref: string | null;
    downloadHref: string | null;
} {
    const [blob, setBlob] = useState<{ mediaId: number; url: string } | null>(null);
    useEffect(() => {
        if (!enabled || mediaId == null || DATA_MODE === 'http') return;
        let url: string | null = null;
        let live = true;
        void (async () => {
            try {
                const client = await getDataClient();
                const { bytes, contentType } = await client.media.getFile(mediaId, treeId);
                if (!live) return;
                url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: contentType }));
                setBlob({ mediaId, url });
            } catch {
                /* the actions stay disabled; the stage shows its own failure */
            }
        })();
        return () => { live = false; if (url) URL.revokeObjectURL(url); };
    }, [enabled, mediaId, treeId]);
    if (!enabled || mediaId == null) return { fileHref: null, downloadHref: null };
    if (DATA_MODE === 'http') {
        const fileHref = mediaFileUrl(mediaId, { treeId });
        return { fileHref, downloadHref: `${fileHref}${fileHref.includes('?') ? '&' : '?'}download=1` };
    }
    const url = blob?.mediaId === mediaId ? blob.url : null;
    return { fileHref: url, downloadHref: url };
}

function linkOwnerKey(owner: MediaLinkOwner): string {
    return `${owner.OwnerTable}:${owner.OwnerId}:${owner.OwnerFact ?? ''}`;
}

function personName(owner: MediaLinkOwner, unknown: string): string {
    return displayFullName({
        FirstName: owner.FirstName, LastName: owner.LastName,
        EffectiveFirstName: owner.EffectiveFirstName, Nickname: owner.Nickname,
    }) || unknown;
}

/** The people a document names, once each, for the peek and the grid caption. */
export function linkedPeopleNames(links: MediaLinkOwner[], unknown: string): string[] {
    const seen = new Map<number, string>();
    for (const link of links) {
        if (link.OwnerTable === 'Sources' || link.OwnerTable === 'Citation' || link.PersonId == null || seen.has(link.PersonId)) continue;
        seen.set(link.PersonId, personName(link, unknown));
    }
    return [...seen.values()];
}

/** One linked record, named and described, with where it opens. */
function useLinkRow() {
    const t = useTranslations('documents');
    const tm = useTranslations('ownerMedia');
    const tp = useTranslations('places');
    const tc = useTranslations('common');
    return (owner: MediaLinkOwner): { name: string; detail: ReactNode; href: string; source: boolean } => {
        const factLabel = owner.OwnerFact === 'Birth' ? tm('fact_birth')
            : owner.OwnerFact === 'Death' ? tm('fact_death')
            : owner.OwnerFact === 'Marriage' ? tm('fact_marriage')
            : null;
        const withDate = (label: string | null): ReactNode => label == null ? null : (
            <>{label}{owner.FactDate && <> · <span className="date-mono"><PhotoDateText date={owner.FactDate} /></span></>}</>
        );
        switch (owner.OwnerTable) {
            case 'Sources':
                return { name: owner.SourceTitle || t('link_source'), detail: t('link_source'), href: librarySourceHref(owner.OwnerId), source: true };
            case 'Citation':
                // A citation's file (#47) names its source, with the page it cites.
                return {
                    name: owner.SourceTitle || t('link_source'),
                    detail: owner.CitationPage ? <>{t('link_citation')} · {owner.CitationPage}</> : t('link_citation'),
                    href: owner.CitationSourceId != null ? librarySourceHref(owner.CitationSourceId) : '#',
                    source: true,
                };
            case 'Families': {
                const partner2 = displayFullName({ FirstName: owner.Partner2FirstName, LastName: owner.Partner2LastName });
                const partner1 = owner.PersonId != null ? personName(owner, tc('unknown')) : '';
                return {
                    name: [partner1, partner2].filter(Boolean).join(' & ') || tc('unknown'),
                    detail: withDate(factLabel ?? t('link_family')),
                    href: `/families/view?id=${owner.OwnerId}`,
                    source: false,
                };
            }
            case 'Events':
                return {
                    name: personName(owner, tc('unknown')),
                    detail: withDate(owner.EventType ? eventTypeLabel(owner.EventType, tp) : t('link_event')),
                    href: owner.PersonId != null ? `/people/view?id=${owner.PersonId}` : '#',
                    source: false,
                };
            default:
                return { name: personName(owner, tc('unknown')), detail: withDate(factLabel), href: `/people/view?id=${owner.OwnerId}`, source: false };
        }
    };
}

/** The desktop rail's Linked to rows, styled like its tagged-people rows. */
export function RailLinkedTo({ links, canEdit, busy, onUnlink }: {
    links: MediaLinkOwner[] | null;
    canEdit: boolean;
    busy: boolean;
    onUnlink: (owner: MediaLinkOwner) => void;
}) {
    const t = useTranslations('documents');
    const row = useLinkRow();
    if (links == null) return null;
    if (links.length === 0) {
        return <div className="text-meta text-white/45 italic leading-relaxed">{t('no_links')}</div>;
    }
    return (
        <div className="flex flex-col gap-[8px]">
            {links.map((owner) => {
                const r = row(owner);
                return (
                    <div key={linkOwnerKey(owner)} className="flex items-center gap-[9px] rounded-md p-1.5 -mx-1.5 transition-colors hover:bg-white/10">
                        <a href={r.href} className="flex items-center gap-[10px] flex-1 min-w-0 rounded-md no-underline text-inherit focus-ring">
                            {r.source
                                ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/10 shrink-0"><BookOpen className="w-[14px] h-[14px]" aria-hidden="true" /></span>
                                : <Avatar name={r.name} size={28} />}
                            <span className="flex-1 min-w-0">
                                <span className={`${r.source ? 'text-sm' : 'serif text-base'} block truncate`}>{r.name}</span>
                                {r.detail && <span className="block text-xs text-white/55">{r.detail}</span>}
                            </span>
                            {!canEdit && <ArrowUpRight className="w-3.5 h-3.5 opacity-60 shrink-0" aria-hidden="true" />}
                        </a>
                        {canEdit && (
                            <button type="button" onClick={() => onUnlink(owner)} disabled={busy}
                                aria-label={t('unlink_named', { name: r.name })} title={t('unlink')}
                                className="inline-flex items-center justify-center w-11 h-11 -m-2 shrink-0 rounded-md opacity-60 transition-colors hover:opacity-100 hover:text-error focus-visible:opacity-100 focus-visible:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error disabled:opacity-40">
                                <X className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/** The phone Details sheet's Linked to rows: each opens its record. */
export function SheetLinkedTo({ links, rowClass }: { links: MediaLinkOwner[] | null; rowClass: string }) {
    const t = useTranslations('documents');
    const row = useLinkRow();
    if (links == null) return null;
    return (
        <ul className="m-0 p-0 list-none">
            {links.map((owner) => {
                const r = row(owner);
                return (
                    <li key={linkOwnerKey(owner)} className="border-t border-white/10 first:border-t-0">
                        <a href={r.href} className={`${rowClass} text-inherit`}>
                            {r.source
                                ? <span className="inline-flex items-center justify-center w-[34px] h-[34px] shrink-0 rounded-full bg-white/10"><BookOpen className="w-[17px] h-[17px]" aria-hidden="true" /></span>
                                : <Avatar name={r.name} size={34} />}
                            <span className="flex-1 min-w-0">
                                <span className="block truncate text-md">{r.name}</span>
                                {r.detail && <span className="block text-xs text-white/55">{r.detail}</span>}
                            </span>
                            <ChevronRight className="w-4 h-4 text-white/45 shrink-0" aria-hidden="true" />
                        </a>
                    </li>
                );
            })}
            {links.length === 0 && <li className="px-[18px] py-3 text-sm text-white/55">{t('no_links')}</li>}
        </ul>
    );
}
