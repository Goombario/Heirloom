'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/app/components/ui/Input';
import { Button } from '@/app/components/ui/Button';
import { GitMerge, MapPin } from '@/lib/icons';
import PlaceRematch from './PlaceRematch';
import type { PhotonCandidate } from '@/lib/geocode/photon';

interface ParsedCoords {
    latitude: number;
    longitude: number;
}

/**
 * Parse a "lat, lng" string into range-validated decimal coordinates.
 * Returns null on any malformed / out-of-range input so the caller can block Save.
 */
export function parseCoords(input: string): ParsedCoords | null {
    const parts = input.split(',').map((s) => s.trim());
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return null;
    const latitude = Number(parts[0]);
    const longitude = Number(parts[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90) return null;
    if (longitude < -180 || longitude > 180) return null;
    return { latitude, longitude };
}

interface PlaceEditFieldsProps {
    placeName: string;
    displayName?: string | null;
    coordsValue: string;
    onCoordsChange: (value: string) => void;
    coordsError: string | null;
    /** There is a pin on the map to drag — so say so next to the field it writes to. */
    draggableHint?: boolean;
    /** The coordinates no longer match the geocoded result (#566). Not an error: a manual
     *  refinement within the matched place, but never silent. */
    pinAdjusted?: boolean;
    // Rename / merge (CRUD §1.2).
    nameValue: string;
    onNameChange: (value: string) => void;
    /** Other place names in the tree — power the merge datalist. */
    otherPlaces: string[];
    /** Apply the rename/merge (the parent confirms, then calls the service). */
    onApplyName: () => void;
    renaming: boolean;
    /** Correct a bad geocoder match (#447). Omitted → no Re-match control at all,
     *  which is what a read-only or offline caller wants. */
    onRematch?: (candidate: PhotonCandidate) => void;
    /** A re-match write is in flight. */
    rematching?: boolean;
    /** The changed name keeps two same-name places apart instead of merging (#1185). */
    separate?: boolean;
    /** Under the changed name: keep the old name, merge or keep apart (#1185). */
    renameChoices?: React.ReactNode;
    /** The Other names group's editor (#1185); omitted, the group is left out. */
    otherNames?: React.ReactNode;
}

/** Section heading for a field group. The groups are the point of the layout, so they
 *  are labelled rather than merely separated by a rule. */
function GroupHeading({ children }: { children: React.ReactNode }) {
    return (
        <div className="eyebrow mb-3">
            {children}
        </div>
    );
}

/**
 * Inline edit form for a place, in three labelled groups (#447):
 *
 *   Identity        — Places.Name, the name YOU gave this place. Renaming it to a name
 *                     another place already has is a MERGE (CRUD §1.2).
 *   Location        — the coordinates, and "Geocoded as": the geocoder's own name for
 *                     whatever it matched (Places.DisplayName). That one is read-only
 *                     provenance, never hand-edited; a wrong match is corrected by
 *                     RE-MATCHING, which rewrites the name and the coordinates together.
 *
 *   Other names     — the names its records were written under at other times or in
 *                     other languages (#1185), each with a language and the years used.
 *
 * The two name fields are labelled per ADR 0017 and must not be relabelled: "Place name"
 * for Places.Name and "Geocoded as" for Places.DisplayName. This form has been
 * mislabelled twice ("Modern name", then "Canonical"/"Display name") because those two
 * columns have colliding plain-English names.
 */
export default function PlaceEditFields({
    placeName,
    displayName,
    coordsValue,
    onCoordsChange,
    coordsError,
    draggableHint = false,
    pinAdjusted = false,
    nameValue,
    onNameChange,
    otherPlaces,
    onApplyName,
    renaming,
    onRematch,
    rematching = false,
    separate = false,
    renameChoices,
    otherNames,
}: PlaceEditFieldsProps) {
    const t = useTranslations('places');

    const trimmedName = nameValue.trim();
    const isMerge = trimmedName !== '' && otherPlaces.includes(trimmedName) && !separate;
    const nameChanged = trimmedName !== '' && trimmedName !== placeName;

    return (
        <div className="space-y-5">
            {/* IDENTITY — Places.Name. First, because it is what the place IS; the
                coordinates are an attribute of it. */}
            <div>
                <GroupHeading>{t('group_identity')}</GroupHeading>
                <Input
                    label={t('place_name')}
                    value={nameValue}
                    onChange={(e) => onNameChange(e.target.value)}
                    list="place-rename-options"
                    hint={t('rename_help')}
                    disabled={renaming}
                />
                <datalist id="place-rename-options">
                    {otherPlaces.map((p) => <option key={p} value={p} />)}
                </datalist>
                {nameChanged && renameChoices}
                <div className="mt-2">
                    <Button
                        variant="outline"
                        onClick={onApplyName}
                        disabled={!nameChanged || renaming}
                        icon={<GitMerge size={14} aria-hidden="true" />}
                    >
                        {renaming ? t('saving') : !nameChanged ? t('rename_place') : isMerge ? t('merge_into', { name: trimmedName }) : t('rename_to', { name: trimmedName })}
                    </Button>
                </div>
            </div>

            {/* LOCATION — the coordinates (persist via geocodeUpsert on Save) and the
                geocoder's provenance for them. `autoFocus` stays HERE and not on the
                name field above: the panel is opened to fix a pin far more often than
                to rename, and a rename already needs a second, deliberate click. */}
            <div className="pt-4 border-t border-border">
                <GroupHeading>{t('group_location')}</GroupHeading>
                <Input
                    label={t('coordinates')}
                    value={coordsValue}
                    onChange={(e) => onCoordsChange(e.target.value)}
                    placeholder={t('coords_placeholder')}
                    hint={coordsError ? undefined : draggableHint ? t('coords_help_draggable') : t('coords_help')}
                    className="tabular-nums"
                    aria-invalid={coordsError ? true : undefined}
                    aria-describedby={coordsError ? 'place-coords-error' : undefined}
                    autoFocus
                />
                {coordsError && (
                    <p id="place-coords-error" role="alert" className="mt-1.5 text-xs text-error">
                        {coordsError}
                    </p>
                )}
                {/* Read-only: the canonical name the geocoder matched for the pin
                    (Places.DisplayName) — real data, sourced from the geocoder, and
                    corrected by re-matching rather than by typing (ADR 0017). */}
                <div className="mt-3" data-testid="geocoded-as-field">
                    <Input
                        label={t('geocoded_as')}
                        value={displayName || '—'}
                        readOnly
                        className="read-only:bg-surface-2 read-only:text-text-muted read-only:cursor-default"
                    />
                    {/* The pin has been moved off the geocoder's own coordinate. The MATCH
                        is still that place — which is why DisplayName and the OSM ids are
                        kept — so this states what happened rather than warning. Icon plus
                        text, no colour-only signal. */}
                    {pinAdjusted && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-text-muted">
                            <MapPin size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
                            <span>{t('pin_adjusted')}</span>
                        </p>
                    )}
                    {onRematch && (
                        <PlaceRematch placeName={placeName} onPick={onRematch} busy={rematching} />
                    )}
                </div>
            </div>

            {otherNames && (
                <div className="pt-4 border-t border-border">
                    <GroupHeading>{t('other_names')}</GroupHeading>
                    {otherNames}
                </div>
            )}
        </div>
    );
}
