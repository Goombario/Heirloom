'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PersonGalleryMedia, PersonWithRelations } from '@/lib/db/schema';
import { getDataClient } from '@/lib/data';
import { MobileRow, cx } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import MediaImg from '@/app/components/MediaImg';
import { Camera, Crop as CropIcon, Eye, ImageIcon, LayoutGrid, Trash2 } from '@/lib/icons';
import { nameBarParts } from './model';
import { PortraitFrame, type PortraitPhoto } from './PortraitFrame';
import { MAX_ZOOM, circleFocal, cropFrom, dragCrop, regionFor, zoomCrop, type Crop, type Size } from './portrait';
import type { RunChange } from './useChange';

/*
 * Portrait actions on the phone (#1051, tracking #1054). Tapping the photo opens the
 * menu: view it, adjust the crop, choose another of the person's photos, take or
 * upload one, or stop using it. Every way in to a new portrait ends on the crop, which
 * saves this person's face tag on the photo and makes it their portrait. The photo's
 * own focal point, shared by every use of it, is never written.
 */

/** Media that can't be a portrait: anything that isn't an image (scanned PDFs and the like). */
function isDocument(m: { ContentType: string | null }): boolean {
    return m.ContentType != null && !m.ContentType.startsWith('image/');
}

/** What the crop needs of a photo: its id, and the face and focal point it opens on. */
type CropMedia = Pick<PersonGalleryMedia, 'Id'> & Partial<Pick<PersonGalleryMedia,
    'IsPersonPrimary' | 'FocalX' | 'FocalY' | 'TagRegionX' | 'TagRegionY' | 'TagRegionW' | 'TagRegionH'>>;

/** The face region already saved for this person on this photo, if any. */
function regionOf(m: CropMedia) {
    return m.TagRegionW != null && m.TagRegionH != null
        ? { RegionX: m.TagRegionX ?? 0, RegionY: m.TagRegionY ?? 0, RegionW: m.TagRegionW, RegionH: m.TagRegionH }
        : null;
}

/** The crop a photo opens with: its saved face, else its focal point. */
export function initialCrop(m: CropMedia | null) {
    return (size: Size): Crop => cropFrom(size, m ? regionOf(m) : null, m ? { x: (m.FocalX ?? 50) / 100, y: (m.FocalY ?? 50) / 100 } : null);
}

type Target = { media: CropMedia } | { file: File; url: string };
type Step = 'menu' | 'media' | 'crop';

export interface PortraitSheetsProps {
    open: boolean;
    onClose: () => void;
    person: PersonWithRelations;
    media: PersonGalleryMedia[];
    treeId: number | null;
    /** Editors only: Remove portrait is a delete row (#1054 Roles). */
    canRemove: boolean;
    run: RunChange;
    onViewPhoto: (m: PersonGalleryMedia) => void;
}

export function PortraitSheets({ open, onClose, person, media, treeId, canRemove, run, onViewPhoto }: PortraitSheetsProps) {
    const t = useTranslations('mobileProfile');
    const [step, setStep] = useState<Step>('menu');
    const [target, setTarget] = useState<Target | null>(null);
    const takeRef = useRef<HTMLInputElement>(null);
    const uploadRef = useRef<HTMLInputElement>(null);
    const name = nameBarParts(person).given || t('this_person');
    const portrait = media.find((m) => m.IsPersonPrimary) ?? null;
    const photos = media.filter((m) => !isDocument(m));

    // Each opening starts on the menu.
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) { setStep('menu'); setTarget(null); }
    }

    // A picked file previews from memory until it's saved, then the URL goes.
    const fileUrl = target && 'url' in target ? target.url : null;
    useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

    const cropOn = (next: Target) => { setTarget(next); setStep('crop'); };
    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) cropOn({ file, url: URL.createObjectURL(file) });
    };

    const remove = async () => {
        if (!portrait) return;
        onClose();
        await run(async () => {
            const client = await getDataClient();
            return client.media.clearPrimary(portrait.Id, person.Id, treeId);
        }, { message: t('portrait_removed'), detail: t('portrait_removed_sub') });
    };

    const fileInputs = (
        <>
            <input ref={takeRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} aria-hidden="true" tabIndex={-1} />
            <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={onFile} aria-hidden="true" tabIndex={-1} />
        </>
    );

    return (
        <Sheet open={open} onClose={onClose} title={portrait ? t('portrait') : t('add_portrait')}>
            {fileInputs}
            <div className="-mx-4 -mt-3">
                {portrait && (
                    <>
                        <MobileRow icon={<Eye />} label={t('view_photo')} end="leave" onClick={() => { onClose(); onViewPhoto(portrait); }} />
                        <MobileRow divided icon={<CropIcon />} label={t('adjust_crop')} end="chevron" onClick={() => cropOn({ media: portrait })} />
                    </>
                )}
                {photos.length > 0 && (
                    <MobileRow divided={!!portrait} icon={<LayoutGrid />} label={t('choose_from_media', { name })}
                        sub={t('photo_count', { count: photos.length })} end="chevron" onClick={() => setStep('media')} />
                )}
                <MobileRow divided={!!portrait || photos.length > 0} icon={<Camera />} label={t('take_photo')} end="chevron" onClick={() => takeRef.current?.click()} />
                <MobileRow divided icon={<ImageIcon />} label={t('upload_photo')} end="chevron" onClick={() => uploadRef.current?.click()} />
                {portrait && canRemove && (
                    <MobileRow divided tone="danger" icon={<Trash2 />} label={t('remove_portrait')} sub={t('portrait_removed_sub')} onClick={remove} />
                )}
            </div>

            <Sheet open={open && step === 'media'} onClose={() => setStep('menu')} onBack={() => setStep('menu')} backKeepsChanges
                title={t('choose_portrait')} size="full">
                {fileInputs}
                <p className="m-0 pb-3 text-base text-text-secondary">{t('choose_portrait_body', { name })}</p>
                {/* Photos first; documents follow, dimmed, since they can't be portraits. */}
                <ul className="list-none m-0 p-0 -mx-4 grid grid-cols-3 gap-[3px]">
                    {[...photos, ...media.filter(isDocument)].map((m) => {
                        const doc = isDocument(m);
                        const alt = m.Title ?? (doc ? t('document') : t('photo'));
                        return (
                            <li key={m.Id} className="relative aspect-square overflow-hidden bg-surface-2">
                                <button type="button" disabled={doc} onClick={() => cropOn({ media: m })}
                                    aria-label={doc ? t('document_not_portrait', { title: alt }) : m.IsPersonPrimary ? t('current_portrait', { title: alt }) : alt}
                                    className="block w-full h-full p-0 cursor-pointer disabled:cursor-default focus-ring-inset">
                                    <MediaImg mediaId={m.Id} contentType={m.ContentType} treeId={treeId} width={256} alt="" loading="lazy" className={cx('w-full h-full object-cover', doc && 'opacity-40')} />
                                    {m.IsPersonPrimary && (
                                        <span aria-hidden="true" className="absolute left-1.5 bottom-1.5 px-2 py-0.5 rounded-full bg-black/60 text-white text-xs font-semibold">{t('portrait')}</span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
                <MobileRow divided icon={<ImageIcon />} label={t('upload_photo')} end="chevron" onClick={() => uploadRef.current?.click()} className="!px-0 mt-3" />
            </Sheet>

            {target && (
                <CropScreen
                    open={open && step === 'crop'}
                    key={'media' in target ? `m${target.media.Id}` : target.url}
                    target={target}
                    person={person}
                    treeId={treeId}
                    run={run}
                    onBack={() => setStep(target && 'media' in target && target.media !== portrait ? 'media' : 'menu')}
                    onDone={onClose}
                />
            )}
        </Sheet>
    );
}

/**
 * The full-screen crop: drag to move, slide to zoom, previews of the page photo and the round
 * thumbnail. The phone photo viewer opens it too, for "Set as X's profile picture" (#1121),
 * and, as `purpose="tag"`, to tag someone's face or move their face tag: the same circle,
 * saved as the face tag alone, with no portrait change and only the round preview.
 */
export function CropScreen({ open, target, person, treeId, run, onBack, onDone, purpose = 'portrait' }: {
    open: boolean; target: Target; person: Pick<PersonWithRelations, 'Id' | 'FirstName' | 'LastName'>; treeId: number | null; run: RunChange;
    onBack: () => void; onDone: () => void; purpose?: 'portrait' | 'tag';
}) {
    const t = useTranslations('mobileProfile');
    const tagging = purpose === 'tag';
    const [stageW, setStageW] = useState(0);
    const [size, setSize] = useState<Size | null>(null);
    const [crop, setCrop] = useState<Crop | null>(null);
    const [start, setStart] = useState<Crop | null>(null);
    const [saving, setSaving] = useState(false);
    const fullName = `${person.FirstName ?? ''} ${person.LastName ?? ''}`.trim();
    const photo: PortraitPhoto = 'media' in target ? { mediaId: target.media.Id } : { fileUrl: target.url };
    const isNew = 'file' in target;
    const wasPortrait = 'media' in target && !!target.media.IsPersonPrimary;
    const hadTag = 'media' in target && target.media.TagRegionW != null;
    const given = (person.FirstName ?? '').trim().split(/\s+/)[0] || fullName;

    // Measured when the stage mounts, not when `open` flips: the sheet's portal puts its
    // content in a render later, so an effect on `open` found no stage and the photo
    // never drew (a blank crop).
    const roRef = useRef<ResizeObserver | null>(null);
    const stageRef = useCallback((el: HTMLDivElement | null) => {
        roRef.current?.disconnect();
        roRef.current = null;
        if (!el) return;
        const ro = new ResizeObserver(() => setStageW(el.clientWidth));
        ro.observe(el);
        roRef.current = ro;
        setStageW(el.clientWidth);
    }, []);
    useEffect(() => () => roRef.current?.disconnect(), []);

    const frame = { w: stageW, h: stageW * 0.75 };
    const onSize = (s: Size) => {
        if (size) return;
        const first = initialCrop('media' in target ? target.media : null)(s);
        setSize(s); setCrop(first); setStart(first);
    };
    // A new photo is a change from the first frame; an existing one once it moves.
    const dirty = isNew || (crop != null && start != null && (crop.zoom !== start.zoom || crop.face.x !== start.face.x || crop.face.y !== start.face.y));

    // Gestures read the latest crop from refs: a finger can move twice before React
    // renders, and building each step on the rendered crop dropped a step (a stutter).
    const live = useRef<{ size: Size | null; frame: Size; crop: Crop | null }>({ size: null, frame, crop: null });
    useEffect(() => { live.current = { size, frame: { w: stageW, h: stageW * 0.75 }, crop }; }, [size, stageW, crop]);
    const change = (step: (size: Size, frame: Size, crop: Crop) => Crop) => {
        const { size: s, frame: f, crop: c } = live.current;
        if (!s || !c || !f.w) return;
        const next = step(s, f, c);
        live.current = { ...live.current, crop: next };
        setCrop(next);
    };

    // One finger drags, two pinch (zooming about the point between them), and a double
    // tap zooms in there (back out from all the way in): the one-finger way to zoom.
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const pinch = useRef<{ dist: number; zoom: number } | null>(null);
    const down = useRef<{ x: number; y: number; moved: boolean } | null>(null);
    const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
    const spread = () => {
        const [a, b] = [...pointers.current.values()];
        return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const inStage = (el: Element, x: number, y: number) => {
        const r = el.getBoundingClientRect();
        return { x: x - r.left, y: y - r.top };
    };

    const onPointerDown = (e: React.PointerEvent) => {
        if (!live.current.crop) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 1) down.current = { x: e.clientX, y: e.clientY, moved: false };
        else if (down.current) down.current.moved = true;
        if (pointers.current.size === 2) pinch.current = { dist: spread().dist || 1, zoom: live.current.crop.zoom };
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const p = pointers.current.get(e.pointerId);
        if (!p) return;
        const pin = pinch.current;
        if (pin && pointers.current.size >= 2) {
            const before = spread();
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const after = spread();
            const mid = inStage(e.currentTarget, after.x, after.y);
            change((s, f, c) => zoomCrop(s, f, dragCrop(s, f, c, after.x - before.x, after.y - before.y), pin.zoom * (after.dist / pin.dist), mid));
            return;
        }
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const d = down.current;
        if (d && !d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.moved = true;
        change((s, f, c) => dragCrop(s, f, c, e.clientX - p.x, e.clientY - p.y));
    };
    const onPointerUp = (e: React.PointerEvent) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        if (pointers.current.size > 0) return;
        const d = down.current;
        down.current = null;
        if (e.type === 'pointercancel' || !d || d.moved) { lastTap.current = null; return; }
        const tap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
        const prev = lastTap.current;
        if (prev && tap.t - prev.t < 350 && Math.hypot(tap.x - prev.x, tap.y - prev.y) < 30) {
            lastTap.current = null;
            const at = inStage(e.currentTarget, tap.x, tap.y);
            change((s, f, c) => zoomCrop(s, f, c, c.zoom >= MAX_ZOOM - 0.01 ? 1 : c.zoom * 1.5, at));
        } else {
            lastTap.current = tap;
        }
    };
    // Arrow keys move the photo and + / - zoom, for a keyboard or switch user.
    const onKeyDown = (e: React.KeyboardEvent) => {
        const step = 8;
        const dx = e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0;
        const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
        const zoom = e.key === '+' || e.key === '=' ? 1.1 : e.key === '-' ? 1 / 1.1 : 0;
        if (!dx && !dy && !zoom) return;
        e.preventDefault();
        change((s, f, c) => (zoom ? zoomCrop(s, f, c, c.zoom * zoom) : dragCrop(s, f, c, dx, dy)));
    };

    const save = async () => {
        if (!size || !crop || saving) return;
        setSaving(true);
        const region = regionFor(size, crop);
        const ok = await run(async () => {
            const client = await getDataClient();
            const auditIds: number[] = [];
            let mediaId: number;
            if ('file' in target) {
                // A new photo goes into their media first; Undo keeps it there.
                mediaId = (await client.media.upload({ file: target.file, personId: person.Id }, treeId)).Id;
            } else {
                mediaId = target.media.Id;
            }
            const mine = (await client.media.listTags(mediaId, treeId)).find((x) => x.PersonId === person.Id);
            const tag = mine
                ? await client.media.updateTag(mediaId, mine.Id, region, treeId)
                : await client.media.createTag(mediaId, { PersonId: person.Id, ...region }, treeId);
            auditIds.push(...tag.auditIds);
            if (!tagging && !wasPortrait) auditIds.push(...(await client.media.setPrimary(mediaId, person.Id, treeId)).auditIds);
            return { auditIds };
        }, { message: tagging ? (hadTag ? t('face_updated', { name: given }) : t('face_tagged', { name: fullName || given })) : wasPortrait ? t('portrait_updated') : t('portrait_added') });
        setSaving(false);
        if (ok) onDone();
    };

    const at = crop;
    const focal = size && crop ? circleFocal(regionFor(size, crop)) : null;

    return (
        <Sheet open={open} onClose={onBack} onBack={onBack} title={tagging ? t('tag_face_title', { name: given }) : t('adjust_portrait')} size="screen" tone="dark"
            onSave={save} saveLabel={tagging ? t('tag_save') : t('use')} dirty={dirty} saveWhenClean saveDisabled={!crop || saving}
            discardMessage={tagging ? t('tag_discard') : t('crop_discard')}>
            <div
                ref={stageRef}
                data-vaul-no-drag=""
                role="img"
                tabIndex={0}
                aria-label={t('crop_stage_label')}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={onKeyDown}
                className="relative -mx-4 mt-2 aspect-[4/3] overflow-hidden bg-black touch-none cursor-grab active:cursor-grabbing focus-ring-inset"
            >
                {stageW > 0 && (
                    <PortraitFrame photo={photo} treeId={treeId} frame={frame} crop={at ?? initialCrop('media' in target ? target.media : null)} alt="" eager stage onSize={onSize} />
                )}
                <div aria-hidden="true" className="absolute inset-0 pointer-events-none mp-crop-grid" />
                <div aria-hidden="true" className="absolute left-1/2 top-[40%] w-[40%] aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-white/85 pointer-events-none shadow-[0_0_0_999px_rgba(0,0,0,0.18)]" />
            </div>
            <p className="m-0 mt-4 text-meta text-text-muted">{tagging ? t('tag_hint', { name: given }) : t('crop_hint')}</p>
            <div className="flex items-end gap-[18px] pt-[18px] pb-1 mt-4 border-t border-border">
                {!tagging && <figure className="m-0 grid gap-1.5 justify-items-start text-xs text-text-muted">
                    <div className="relative w-[132px] aspect-[4/3] overflow-hidden rounded-md">
                        {crop && <PortraitFrame photo={photo} treeId={treeId} frame={{ w: 132, h: 99 }} crop={crop} alt="" />}
                        <b className="absolute left-[7px] bottom-[5px] serif text-xs font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">{fullName}</b>
                    </div>
                    {t('preview_page')}
                </figure>}
                <figure className="m-0 grid gap-1.5 justify-items-start text-xs text-text-muted">
                    <div className={cx('relative w-11 h-11 overflow-hidden rounded-full')}>
                        {size && focal && <CircleThumb photo={photo} size={size} focal={focal} treeId={treeId} />}
                    </div>
                    {tagging ? t('preview_face') : t('preview_thumb')}
                </figure>
            </div>
        </Sheet>
    );
}

/** The round thumbnail's preview: the face circle filling a 44px disc. */
function CircleThumb({ photo, size, focal, treeId }: { photo: PortraitPhoto; size: Size; focal: { focalX: number; focalY: number; focalRadius: number }; treeId: number | null }) {
    // The circle's diameter in photo pixels, scaled to 44px, centred on the face.
    const d = (focal.focalRadius / 100) * Math.min(size.w, size.h);
    const zoomOverCover = Math.max(1, Math.min(size.w, size.h) / d);
    const crop: Crop = { face: { x: focal.focalX / 100, y: focal.focalY / 100 }, zoom: zoomOverCover };
    return <PortraitFrame photo={photo} treeId={treeId} frame={{ w: 44, h: 44 }} crop={crop} faceAt={{ x: 0.5, y: 0.5 }} alt="" />;
}
