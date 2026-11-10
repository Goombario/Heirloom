'use client';

import { type Ref } from 'react';
import { useTranslations } from 'next-intl';
import PersonPicker, { type PersonPickerHandle } from '@/app/components/PersonPicker';
import { mediaFileUrl } from '@/lib/media-url';
import { AlertTriangle } from '@/lib/icons';
import type { PersonResult } from '@/lib/db/schema';
import type { FaceRegionInput } from './types';

interface WhoIsThisModalProps {
    pickerRef: Ref<PersonPickerHandle>;
    excludeIds: number[];
    treeId: number | null;
    /** The photo + drawn region — used to crop the face thumbnail in the header. */
    mediaId: number;
    region: FaceRegionInput;
    busy: boolean;
    /** Name on an existing tag this box mostly covers (#802); shows a warning. */
    overlapName?: string | null;
    onPick: (p: PersonResult) => void;
    onCancel: () => void;
}

/**
 * Floating "Who is this?" modal for a freshly drawn face box, shared by mobile
 * and desktop. Hosts the shared PersonPicker in `inline` mode so results flow
 * inside the panel.
 *
 * Keyboard handling: the panel is top-anchored on mobile (`items-start`) and
 * centered on desktop (`md:items-center`). A top-anchored panel with a capped
 * body height (`max-h-[40dvh]`) floats clear of the soft keyboard whether or not
 * the root viewport's `interactive-widget=resizes-content` reflows — replacing
 * the old bottom `Drawer` that fought the keyboard for the same edge. The
 * `max-h-[40dvh]` body cap plus the 40px top inset are the no-reflow fallback,
 * sized so the panel clears a typical (~42%-tall) soft keyboard; when
 * `interactive-widget=resizes-content` does reflow the viewport, the body simply
 * gets the freed space.
 *
 * Purely presentational: MediaLightbox owns autofocus (rAF → pickerRef.focus())
 * and Escape-to-close, so this component adds neither.
 */
export default function WhoIsThisModal({
    pickerRef, excludeIds, treeId, mediaId, region, busy, overlapName, onPick, onCancel,
}: WhoIsThisModalProps) {
    const ft = useTranslations('faceTags');
    const tc = useTranslations('common');

    // Crop the boxed region into the header thumbnail. Non-uniform background-size
    // frames the region exactly (mild distortion is fine at 44px); guard the
    // full-width/height edge case where the position divisor would be zero.
    //
    // The size divisor needs its own floor (#95): a degenerate zero-width or
    // zero-height region divides to Infinity, and `Infinity%` is an invalid
    // background-size that drops the crop entirely. Clamping to 1% renders a
    // heavily zoomed but valid thumbnail instead of a blank one.
    const cropW = Math.max(region.RegionW, 1);
    const cropH = Math.max(region.RegionH, 1);
    const posX = region.RegionW >= 100 ? 50 : (region.RegionX / (100 - region.RegionW)) * 100;
    const posY = region.RegionH >= 100 ? 50 : (region.RegionY / (100 - region.RegionH)) * 100;
    const faceThumb: React.CSSProperties = {
        backgroundImage: `url(${mediaFileUrl(mediaId, { treeId })})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${10000 / cropW}% ${10000 / cropH}%`,
        backgroundPosition: `${posX}% ${posY}%`,
    };

    return (
        <div
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            className="fixed inset-0 z-70 flex items-start justify-center md:items-center px-3"
            style={{ background: 'var(--color-lightbox-scrim)', paddingTop: 'max(env(safe-area-inset-top), 40px)' }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                data-testid="who-is-this-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="who-is-this-title"
                aria-describedby="who-is-this-subtitle"
                // eslint-disable-next-line no-restricted-syntax -- intentional modal-dialog surface (sized/positioned), not a content Card
                className="flex flex-col bg-card text-text rounded-xl shadow-xl overflow-hidden md:my-auto"
                style={{ width: 'min(420px, 100%)' }}
            >
                {/* header: cropped face thumb + title/subtitle + Cancel link */}
                <div className="flex items-center gap-3 px-5 pt-4 pb-3 shrink-0">
                    <div className="w-11 h-11 rounded-[9px] border-2 border-border shrink-0 shadow-sm bg-card-alt" style={faceThumb} aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                        <h3 id="who-is-this-title" className="title-dialog">{ft('who_is_this')}</h3>
                        <p id="who-is-this-subtitle" className="text-meta text-text-muted mt-0.5">{ft('who_is_this_subtitle')}</p>
                    </div>
                    <button type="button" onClick={onCancel} disabled={busy}
                        className="text-base text-link font-medium px-1.5 min-h-11 shrink-0 rounded transition-opacity hover:opacity-80 disabled:opacity-50 focus-ring">
                        {tc('cancel')}
                    </button>
                </div>

                {overlapName && (
                    <p role="status" className="flex items-start gap-2 mx-5 mb-3 rounded-lg p-2.5 text-meta bg-warning-bg text-warning-text">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
                        {ft('overlap_warning', { name: overlapName })}
                    </p>
                )}

                {/* search + results — capped + scrollable so result names fill the
                    space above the keyboard and never extend into it. */}
                <div data-testid="who-is-this-results"
                    className="border-t border-border px-5 pt-3 pb-4 overflow-y-auto overscroll-contain max-h-[40dvh]">
                    <PersonPicker
                        ref={pickerRef}
                        inline
                        inlineResultsClassName=""
                        value={null}
                        onChange={(p) => { if (p) onPick(p); }}
                        excludeIds={excludeIds}
                        treeId={treeId}
                        showDates
                    />
                </div>
            </div>
        </div>
    );
}
