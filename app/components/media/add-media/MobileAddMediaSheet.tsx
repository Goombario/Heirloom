'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import MediaImg from '@/app/components/MediaImg';
import { FilterChip, MobileRow, RadioRow, cx } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { ChevronRight, ImageUp, Info, Search, UserRound } from '@/lib/icons';
import { isPdfMedia } from '@/lib/media/allowed-extensions';
import type { MediaWithPerson } from '@/lib/db/schema';
import { AddMediaTile, NewFileImage } from './AddMediaTile';
import type { UploadRow } from './useUploadBatch';

type RowState = { flag: { text: string; ink?: boolean } | null; label: string; progress: 'waiting' | 'uploading' | 'done' | null };

/**
 * Add media on a phone (#1204): a full-height sheet with Cancel, the title and a copper
 * Add N. An "Upload from this phone" row comes first, then a filter field, the All ·
 * Photos · Documents chips and the same sections as the desktop modal, in an
 * edge-to-edge 3-column grid without captions. The state lives in AddMediaModal.
 */
export function MobileAddMediaSheet({
    toLine, rows, rowState, sections, picked, treeId, loading, emptyLibrary, emptyLabel, allAttached, showSearch, noMatches,
    query, kind, kindOptions, swapNote, banners, scanning, busy, canAdd, addLabel, showPrimary,
    onBrowse, onToggleRow, onSetPrimary, onToggleLibrary, onQuery, onKind, onAdd, onClose,
}: {
    toLine: ReactNode;
    rows: UploadRow[];
    rowState: (row: UploadRow) => RowState;
    sections: { key: string; title: string; why: string; items: MediaWithPerson[] }[] | null;
    picked: Set<number>;
    treeId: number | null;
    loading: boolean;
    emptyLibrary: boolean;
    emptyLabel: string | null;
    allAttached: boolean;
    showSearch: boolean;
    noMatches: boolean;
    query: string;
    kind: string;
    kindOptions: { v: string; l: string }[];
    swapNote: string | null;
    banners: ReactNode;
    scanning: boolean;
    busy: boolean;
    canAdd: boolean;
    addLabel: string;
    showPrimary: boolean;
    onBrowse: () => void;
    onToggleRow: (id: string) => void;
    onSetPrimary: (id: string | null) => void;
    onToggleLibrary: (id: number) => void;
    onQuery: (q: string) => void;
    onKind: (k: string) => void;
    onAdd: () => void;
    onClose: () => void;
}) {
    const t = useTranslations('addMedia');
    const tu = useTranslations('upload');
    const tc = useTranslations('common');
    const tm = useTranslations('mobileUpload');
    const [profileOpen, setProfileOpen] = useState(false);
    const photos = rows.filter(r => !r.document && r.libraryId == null && (r.selected || r.done));
    const primaryIndex = rows.findIndex(r => r.primary);

    return (
        <Sheet open onClose={onClose} title={t('title')} size="full"
            onSave={onAdd} saveLabel={addLabel} saveWhenClean saveDisabled={!canAdd}>
            <div className="-mx-4 -mt-3">
                {toLine && <p className="m-0 px-4 pt-1 pb-2.5 text-center text-meta text-text-muted border-b border-border">{toLine}</p>}

                <div className="grid gap-2 px-4 empty:hidden [&>*]:mt-2">{banners}</div>

                <button type="button" onClick={onBrowse} disabled={busy}
                    className="flex w-full min-h-[60px] items-center gap-3 px-4 py-2.5 border-b border-border bg-transparent text-left cursor-pointer focus-ring-inset disabled:opacity-55">
                    <span aria-hidden="true" className="grid w-[34px] h-[34px] shrink-0 place-items-center rounded-lg bg-surface-2 text-text">
                        <ImageUp className="w-[18px] h-[18px]" />
                    </span>
                    <span className="min-w-0">
                        <span className="block text-base font-semibold text-text">{rows.length > 0 ? t('upload_more_phone') : t('upload_phone')}</span>
                        <span className="block text-meta text-text-muted">{t('phone_limit')}</span>
                    </span>
                    <ChevronRight className="ml-auto w-[18px] h-[18px] text-text-muted" aria-hidden="true" />
                </button>

                {showPrimary && photos.length > 0 && (
                    <MobileRow icon={<UserRound aria-hidden="true" />} label={tm('profile_picture')} end="chevron" disabled={busy}
                        value={primaryIndex >= 0 ? tm('photo_n', { n: primaryIndex + 1 }) : tm('keep_current')} onClick={() => setProfileOpen(true)} />
                )}

                {showSearch && (
                    <div className={cx(busy && 'opacity-55 pointer-events-none')}>
                        <div className="px-4 pt-3 pb-1">
                            <div className="relative">
                                <Search className="absolute left-[13px] top-[13px] w-[18px] h-[18px] text-text-muted pointer-events-none" aria-hidden="true" />
                                <input type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t('filter_placeholder')} aria-label={t('filter_placeholder')}
                                    autoComplete="off" disabled={busy}
                                    className="w-full h-11 rounded-full border border-border bg-card pl-10 pr-4 text-md text-text placeholder:text-text-muted input-nozoom focus-ring" />
                            </div>
                        </div>
                        <div className="flex gap-2 px-4 pt-2.5 pb-3" role="group" aria-label={t('kind_label')}>
                            {kindOptions.map(o => (
                                <FilterChip key={o.v} active={kind === o.v} label={o.l} onClick={() => onKind(o.v)} disabled={busy} className="min-h-[34px]" />
                            ))}
                        </div>
                    </div>
                )}

                {emptyLibrary && rows.length === 0 && (
                    <div className="px-8 pt-10 pb-6 text-center">
                        <div aria-hidden="true" className="mx-auto mb-3 grid w-14 h-14 place-items-center rounded-full bg-surface-2 text-text-secondary">
                            <ImageUp className="w-6 h-6" />
                        </div>
                        <h3 className="m-0 mb-1 text-md font-semibold text-text">{t('phone_empty_title')}</h3>
                        <p className="m-0 text-base text-text-muted">{emptyLabel ?? t('phone_empty_body')}</p>
                    </div>
                )}
                {allAttached && <p className="m-0 px-6 py-6 text-center text-sm text-text-muted">{t('all_attached')}</p>}

                {rows.length > 0 && (
                    <section aria-label={t('section_new_phone')}>
                        <PhoneSectionHead title={t('section_new_phone')} count={rows.length} why={scanning ? tu('scanning') : ''} live={scanning} />
                        {swapNote && (
                            <p className="m-0 flex gap-2 px-4 pb-3 text-meta text-text-secondary">
                                <Info className="w-3.5 h-3.5 mt-px shrink-0 text-link" aria-hidden="true" /><span>{swapNote}</span>
                            </p>
                        )}
                        <div className="grid grid-cols-3 gap-0.5">
                            {rows.map((row, i) => {
                                const state = rowState(row);
                                return (
                                    <AddMediaTile key={row.id} variant="phone"
                                        image={<NewFileImage preview={row.preview} document={row.document} />}
                                        caption={row.file.name}
                                        label={`${tm('photo_n', { n: i + 1 })} · ${state.label}${row.primary ? ` · ${tm('profile')}` : ''}`}
                                        selected={row.selected || row.done} disabled={busy || row.done}
                                        onToggle={() => onToggleRow(row.id)}
                                        documentBadge={row.document ? t('badge_pdf') : null}
                                        flag={row.primary && !state.progress ? { text: tm('profile') } : state.flag}
                                        progress={state.progress} waitingLabel={t('waiting')} />
                                );
                            })}
                        </div>
                    </section>
                )}

                {loading && <p className="m-0 py-8 text-center text-sm text-text-muted">{tc('loading')}</p>}

                {noMatches && (
                    <div className="grid justify-items-center gap-1 px-6 py-8 text-center">
                        <b className="text-md font-semibold">{query.trim() ? t('no_match_title', { query: query.trim() }) : t('no_match_kind', { kind })}</b>
                        <p className="m-0 text-sm text-text-muted">{t('no_match_hint')}</p>
                        <button type="button" onClick={() => { onQuery(''); onKind('all'); }} className="min-h-11 text-base font-semibold text-link cursor-pointer rounded-lg focus-ring">{tc('clear_search')}</button>
                    </div>
                )}

                {sections?.map(section => (
                    <section key={section.key} aria-label={section.title} className={cx(busy && 'opacity-55 pointer-events-none')}>
                        <PhoneSectionHead title={section.title} count={section.items.length} why={section.why} />
                        <div className="grid grid-cols-3 gap-0.5">
                            {section.items.map(m => (
                                <AddMediaTile key={m.Id} variant="phone"
                                    image={<MediaImg mediaId={m.Id} contentType={m.ContentType} treeId={treeId} width={256} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                    caption={m.Title || t('untitled')} label={m.Title || t('untitled')}
                                    selected={picked.has(m.Id)} disabled={busy}
                                    onToggle={() => onToggleLibrary(m.Id)}
                                    documentBadge={isPdfMedia(m) ? t('badge_pdf') : null} />
                            ))}
                        </div>
                    </section>
                ))}
                <div className="h-6" aria-hidden="true" />
            </div>

            <Sheet open={profileOpen} onClose={() => setProfileOpen(false)} title={tm('profile_picture')}>
                <div role="radiogroup" aria-label={tm('profile_picture')} className="-mx-4 -mt-3">
                    <RadioRow checked={primaryIndex < 0} label={tm('keep_current')} divided={false} onSelect={() => { onSetPrimary(null); setProfileOpen(false); }} />
                    <ul className="grid grid-cols-3 gap-0.5 mt-1 p-0 list-none">
                        {photos.map((row) => (
                            <li key={row.id} className="relative aspect-square">
                                <button type="button" onClick={() => { onSetPrimary(row.id); setProfileOpen(false); }} role="radio" aria-checked={row.primary}
                                    aria-label={tm('photo_n', { n: rows.indexOf(row) + 1 })}
                                    className={cx('absolute inset-0 block w-full h-full p-0 overflow-hidden cursor-pointer focus-ring-inset', row.primary && 'ring-4 ring-inset ring-text')}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={row.preview} alt="" className="w-full h-full object-cover" />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            </Sheet>
        </Sheet>
    );
}

function PhoneSectionHead({ title, count, why, live }: { title: string; count: number; why: string; live?: boolean }) {
    return (
        <div className="flex items-baseline px-4 pt-3.5 pb-2 border-t border-border">
            <h3 className="m-0 eyebrow">{title}{' '}<span className="ml-1 font-mono font-normal tracking-normal">{count}</span></h3>
            <span className="ml-auto text-meta text-text-muted" role={live ? 'status' : undefined}>{why}</span>
        </div>
    );
}
