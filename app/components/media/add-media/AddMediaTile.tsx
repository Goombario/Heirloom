'use client';

import type { ReactNode } from 'react';
import { Check, FileText, Star } from '@/lib/icons';
import { cx } from '@/app/components/ui';

export interface AddMediaTileProps {
    /** Desktop: a rounded tile with a caption and meta line. Phone: edge to edge, no caption. */
    variant: 'desktop' | 'phone';
    /** The thumbnail: a library `MediaImg`, or a new file's preview. */
    image: ReactNode;
    caption: string;
    meta?: ReactNode;
    /** Accessible name for the pick toggle. */
    label: string;
    selected: boolean;
    disabled: boolean;
    onToggle: () => void;
    /** "PDF" on a document tile. */
    documentBadge?: string | null;
    /** "New" or "In library", top right. `ink` is the filled library flag. */
    flag?: { text: string; ink?: boolean } | null;
    /** A new photo from a person: the Primary pill, which is also its toggle. */
    primary?: { on: boolean; label: string; setLabel: string; onToggle: () => void } | null;
    /** While uploading: queued, going up, or up. */
    progress?: 'waiting' | 'uploading' | 'done' | null;
    waitingLabel?: string;
}

/**
 * One tile in Add media (#1204), for a library item and a new file alike. Picked is an
 * ink inset ring plus a filled ink check (never a colour alone), so the state survives
 * having its colour removed. The Primary control sits beside the pick toggle, not
 * inside it, so there is never a button in a button.
 */
export function AddMediaTile({
    variant, image, caption, meta, label, selected, disabled, onToggle,
    documentBadge, flag, primary, progress, waitingLabel,
}: AddMediaTileProps) {
    const phone = variant === 'phone';
    return (
        <div className={cx('relative min-w-0', phone && 'aspect-square')}>
            <div className={cx('relative', !phone && 'aspect-square', phone && 'h-full')}>
                <button
                    type="button"
                    onClick={onToggle}
                    disabled={disabled}
                    aria-pressed={selected}
                    aria-label={label}
                    className={cx(
                        'absolute inset-0 block w-full h-full p-0 overflow-hidden bg-card-alt cursor-pointer disabled:cursor-default',
                        phone ? 'focus-ring-inset' : 'rounded-lg focus-ring',
                    )}
                >
                    {image}
                    {selected && <span aria-hidden="true" className={cx('absolute inset-0 ring-[3px] ring-inset ring-text', !phone && 'rounded-lg')} />}
                    {documentBadge && (
                        <span aria-hidden="true" className="absolute right-1.5 bottom-1.5 rounded px-1.5 bg-media-scrim text-xs font-semibold tracking-wide text-on-media">{documentBadge}</span>
                    )}
                    {progress === 'waiting' && (
                        <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/45 text-meta font-semibold text-white">{waitingLabel}</span>
                    )}
                    {progress === 'uploading' && (
                        <>
                            <span aria-hidden="true" className="absolute inset-0 bg-black/45" />
                            <span aria-hidden="true" className="absolute inset-x-2 bottom-2 h-1.5 rounded-full bg-white/45 overflow-hidden">
                                <span className="block h-full w-1/2 rounded-full bg-white animate-[upload-bar_1.1s_ease-in-out_infinite] motion-reduce:animate-none" />
                            </span>
                        </>
                    )}
                    {progress === 'done' && (
                        <span aria-hidden="true" className="absolute right-1.5 bottom-1.5 grid place-items-center w-[26px] h-[26px] rounded-full bg-success text-white">
                            <Check className="w-3.5 h-3.5" strokeWidth={3} />
                        </span>
                    )}
                </button>
                <span aria-hidden="true" className={cx(
                    'pointer-events-none absolute left-1.5 top-1.5 grid place-items-center w-6 h-6 rounded-full border-2',
                    selected ? 'bg-text border-card text-card' : 'border-white bg-black/20 text-transparent',
                )}>
                    <Check className="w-3.5 h-3.5" strokeWidth={3} />
                </span>
                {flag && (
                    <span aria-hidden="true" className={cx(
                        'pointer-events-none absolute right-1.5 top-1.5 rounded-full px-2 text-xs font-semibold leading-5',
                        flag.ink ? 'bg-text text-card' : 'bg-card text-text',
                    )}>{flag.text}</span>
                )}
                {primary && !progress && (
                    <button
                        type="button"
                        onClick={primary.onToggle}
                        disabled={disabled}
                        aria-pressed={primary.on}
                        aria-label={primary.on ? primary.label : primary.setLabel}
                        title={primary.on ? primary.label : primary.setLabel}
                        className={cx(
                            'absolute left-1 bottom-1 inline-flex items-center gap-1 min-h-8 rounded-full px-2 text-xs font-semibold focus-ring',
                            primary.on ? 'bg-media-scrim text-on-media' : 'min-w-8 justify-center bg-black/35 text-white',
                        )}
                    >
                        <Star className="w-3 h-3" fill={primary.on ? 'currentColor' : 'none'} aria-hidden="true" />
                        {primary.on && primary.label}
                    </button>
                )}
            </div>
            {!phone && (
                <>
                    <div className="mt-1.5 text-sm text-text truncate" title={caption}>{caption}</div>
                    {meta && <div className="text-meta text-text-muted truncate">{meta}</div>}
                </>
            )}
        </div>
    );
}

/** A new file's thumbnail: its preview, or a document glyph until the first page is drawn. */
export function NewFileImage({ preview, document }: { preview: string; document: boolean }) {
    if (!preview) {
        return (
            <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-text-muted">
                <FileText className="w-8 h-8" />
            </span>
        );
    }
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" loading="lazy" decoding="async"
            className={cx('absolute inset-0 w-full h-full', document ? 'object-contain p-2' : 'object-cover')} />
    );
}
