'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import { isPdfMedia } from '@/lib/media/allowed-extensions';
import { ArrowUpRight, Paperclip, X } from '@/lib/icons';
import MediaImg from '@/app/components/MediaImg';
import AddMediaModal from '@/app/components/media/AddMediaModal';
import { useDocumentFile } from '@/app/components/lightbox/DocumentLinks';
import { Button } from '@/app/components/ui';
import { cx } from '@/app/components/ui/cx';
import type { Media } from '@/lib/db/schema';

/**
 * The PDF page a citation's page or line names (#47): "4", "p. 4", "page 4" or
 * "pg 4" at the start. Anything else ("Vol. 1889, entry 1") names no page.
 */
export function pdfPageOf(page: string | null | undefined): number | null {
    const match = /^\s*(?:(?:p|pg|page)\.?\s*)?(\d{1,5})\b/i.exec(page ?? '');
    if (!match) return null;
    const n = Number(match[1]);
    return n > 0 ? n : null;
}

/** "Birth register · PDF · page 4": what a citation's file is, for its line and field. */
export function useCitationFileMeta() {
    const t = useTranslations('citationFile');
    return (file: { contentType: string | null }, page: string | null | undefined): string => {
        if (!isPdfMedia({ ContentType: file.contentType })) return t('kind_image');
        const n = pdfPageOf(page);
        return n == null ? t('kind_pdf') : t('kind_pdf_page', { page: n });
    };
}

/**
 * The quiet paperclip line on a citation row (#47): the file's title and kind.
 * Not a control: the row it sits in is the target.
 */
export function CitationFileLine({ title, contentType, page, className }: {
    title: string | null;
    contentType: string | null;
    page: string | null | undefined;
    className?: string;
}) {
    const t = useTranslations('citationFile');
    const meta = useCitationFileMeta();
    const name = title?.trim() || t('untitled');
    return (
        <span
            aria-label={t('line_aria', { title: name })}
            className={cx('inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border border-border px-1.5 py-px text-xs text-text-secondary', className)}
        >
            <Paperclip size={12} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 truncate">{name}</span>
            <span aria-hidden="true" className="shrink-0 text-text-muted">· {meta({ contentType }, page)}</span>
        </span>
    );
}

/** One linked file: thumbnail, title, kind, Open, and Remove for an editor. */
function FileRow({ file, treeId, page, canEdit, busy, onRemove }: {
    file: Media;
    treeId: number | null;
    page: string | null | undefined;
    canEdit: boolean;
    busy: boolean;
    onRemove: () => void;
}) {
    const t = useTranslations('citationFile');
    const meta = useCitationFileMeta();
    const pdf = isPdfMedia(file);
    const { fileHref } = useDocumentFile(file.Id, treeId, true);
    const n = pdf ? pdfPageOf(page) : null;
    const href = fileHref == null ? null : n == null ? fileHref : `${fileHref}#page=${n}`;
    const name = file.Title?.trim() || t('untitled');
    return (
        <div className="flex items-center gap-3 rounded-[10px] border border-border bg-surface-2 p-2">
            <MediaImg
                mediaId={file.Id}
                treeId={treeId}
                contentType={file.ContentType}
                width={96}
                alt=""
                className="h-12 w-12 shrink-0 rounded-md border border-border object-cover"
            />
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-text">{name}</div>
                <div className="text-meta text-text-muted">{meta({ contentType: file.ContentType }, page)}</div>
            </div>
            {href && (
                <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-9 items-center gap-1 rounded px-2 text-sm text-link hover:underline focus-ring"
                >
                    {t('open')}
                    <ArrowUpRight size={14} aria-hidden="true" />
                </a>
            )}
            {canEdit && (
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={onRemove}
                    aria-label={t('remove_aria', { title: name })}
                    icon={<X size={14} aria-hidden="true" />}
                >
                    {t('remove')}
                </Button>
            )}
        </div>
    );
}

/**
 * A citation's File field (#47), for the desktop citation editor and the phone
 * citation sheet: its linked files, each opened at the PDF page the citation's
 * page names, with Attach (upload or pick from the library) and Remove for an
 * editor. Remove only unlinks: the file stays in the library.
 */
export function CitationFileField({ citationId, treeId, page, canEdit, targetName, onChange, className }: {
    citationId: number;
    treeId: number | null;
    page: string | null | undefined;
    canEdit: boolean;
    /** Names the citation on Add media's "To" line. */
    targetName?: string | null;
    /** Files were attached or removed, so a list showing the citation's line can refresh. */
    onChange?: () => void;
    className?: string;
}) {
    const t = useTranslations('citationFile');
    const [files, setFiles] = useState<Media[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [adding, setAdding] = useState(false);

    const load = useCallback(async () => {
        try {
            const client = await getDataClient();
            setFiles(await client.media.listForOwner('Citation', citationId, treeId));
            setError(null);
        } catch {
            setError(t('load_failed'));
        }
    }, [citationId, treeId, t]);

    useEffect(() => {
        setFiles(null);
        void load();
    }, [load]);

    const remove = async (file: Media) => {
        setBusy(true);
        try {
            const client = await getDataClient();
            await client.media.unlinkFromOwner(file.Id, 'Citation', citationId, treeId);
            setError(null);
            await load();
            onChange?.();
        } catch {
            setError(t('remove_failed'));
        } finally {
            setBusy(false);
        }
    };

    const showHint = files?.some((f) => isPdfMedia(f)) && pdfPageOf(page) != null;
    if (!canEdit && files != null && files.length === 0 && !error) return null;

    return (
        <div className={cx('grid gap-1.5', className)}>
            <span className="text-meta font-semibold text-text-secondary">{t('label')}</span>
            {files?.map((file) => (
                <FileRow key={file.Id} file={file} treeId={treeId} page={page} canEdit={canEdit} busy={busy} onRemove={() => void remove(file)} />
            ))}
            {showHint && <span className="text-meta text-text-muted">{t('opens_at_page')}</span>}
            {error && <span role="alert" className="text-meta text-error">{error}</span>}
            {canEdit && files != null && (
                <div>
                    <Button variant="outline" size="sm" icon={<Paperclip size={14} aria-hidden="true" />} onClick={() => setAdding(true)}>
                        {files.length > 0 ? t('attach_another') : t('attach')}
                    </Button>
                </div>
            )}
            {adding && (
                <AddMediaModal
                    target={{ kind: 'owner', ownerTable: 'Citation', ownerId: citationId }}
                    treeId={treeId}
                    targetName={targetName}
                    onClose={() => setAdding(false)}
                    onAdded={() => { setAdding(false); void load(); onChange?.(); }}
                    onMediaChanged={() => { void load(); onChange?.(); }}
                />
            )}
        </div>
    );
}
