'use client';

import { useState, useRef, useCallback, useEffect, useId, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  resolvePlace, resolvePin, fetchCandidates, chainFromCandidate,
  type HierarchyLevel, type PinNode, type ResolvedPin, type PhotonCandidate,
} from '@/lib/geocode/photon';
import { isGeocodingEnabled } from '@/lib/geocode/prefs';
import { useGeocodingChoice } from '@/app/hooks/useGeocodingChoice';
import GeocodingPrompt from '@/app/components/GeocodingPrompt';
import { getDataClient } from '@/lib/data';
import { parseCoords } from '@/app/places/view/PlaceEditFields';
import { Button } from '@/app/components/ui/Button';
import { Input } from '@/app/components/ui/Input';
import { Sheet } from '@/app/components/ui/Sheet';
import { cx } from '@/app/components/ui/cx';
import { ChevronRight, Globe, Search, Plus, MapPin, Tag } from '@/lib/icons';
import { useNoAutofill } from '@/app/hooks/useNoAutofill';
import { foldForSearch } from '@/lib/utils/search-fold';
import { matchPlaceOptions, sameNamePlaces, settlePlaceText, type PlaceMatch } from '@/lib/places/place-options';
import { useTreePlaceOptions } from './useTreePlaceOptions';

export interface LocationFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Fires whenever the pending resolution changes — the containing form holds
   *  this and flushes it to the server only after its own save succeeds
   *  (design spec §6.1). `null` means an explicit Remove Pin (queues a
   *  suppression); `undefined` means "no pending change" — too-short input,
   *  geocoding disabled, or a transient resolve failure. These are NOT the
   *  same as removal: they must not queue a PinSuppressed write on save. */
  onResolve?: (levels: HierarchyLevel[] | null | undefined) => void;
  /** Fires when the user clicks Remove pin — the form should flush a suppression
   *  (PinSuppressed = true) instead of a hierarchy write for this field on save. */
  onRemove?: () => void;
  /** The place's already-saved ParentId chain (root → leaf), looked up read-only by
   *  the containing form's load effect. Seeds the badge on mount with no Photon call.
   *  Flows through the SAME `resolvePin` the live path uses, so an inherited pin
   *  (leaf has no own coordinate) badges the owning ancestor's canonical name.
   *  Permanently ignored once the user types, picks, or removes. Never triggers a
   *  write — `onResolve` is not called for this seed. */
  initialChain?: PinNode[] | null;
  treeId?: number | null;
  className?: string;
  placeholder?: string;
  id?: string;
  /** The place the field links to, by id (#1186): the record's saved place, or the
   *  one picked since. Absent when the form doesn't track it; the text then links
   *  as the server links it. */
  placeId?: number | null;
  /** The user picked a place (its id), left text that names one (its id), or typed
   *  a new place (null). The form sends it with the save as the fact's place id. */
  onPlaceIdChange?: (placeId: number | null) => void;
  /** `sheet` on phone forms: the field is a row that opens a sheet to type or pick
   *  in, and Done keeps the typed text. */
  variant?: 'inline' | 'sheet';
  /** The sheet's title and the list's name: the field's label. */
  label?: string;
}

const DEBOUNCE_MS = 350;

/** Adapts an ordered HierarchyLevel[] (leaf last) to resolvePin's PinNode shape,
 *  carrying each level's canonical displayName through for the badge. */
function levelsToNodes(levels: HierarchyLevel[]): PinNode[] {
  return levels.map((l) => ({ name: l.name, latitude: l.latitude, longitude: l.longitude, pinSuppressed: false, displayName: l.displayName ?? null }));
}

/** Walks an ordered PinNode[] (leaf last) through resolvePin — the leaf's own
 *  coordinate wins; otherwise the walk climbs to the nearest ancestor that owns
 *  one. Returns the ResolvedPin (canonical displayName + isOwnPin) or null. */
function pinFromNodes(nodes: PinNode[]): ResolvedPin | null {
  if (nodes.length === 0) return null;
  const getParent = (node: PinNode) => {
    const i = nodes.indexOf(node);
    return i > 0 ? nodes[i - 1] : null;
  };
  return resolvePin(nodes[nodes.length - 1], getParent);
}

/** Map suggestions offered under the tree's own places. */
const MAP_ROWS = 4;

type Row = { kind: 'tree'; option: PlaceMatch } | { kind: 'map'; candidate: PhotonCandidate };

const shortName = (name: string) => name.split(',')[0]?.trim() || name;

export default function LocationField({
  value, onChange, onResolve, onRemove, initialChain, treeId, className, placeholder, id,
  placeId, onPlaceIdChange, variant = 'inline', label,
}: LocationFieldProps) {
  // Chrome's saved-address autofill covers this field's own suggestions and
  // offers the USER's address for a place a relative lived in a century ago (#442).
  const noAutofill = useNoAutofill();
  const t = useTranslations('locationField');
  const listId = useId();
  const [levels, setLevels] = useState<HierarchyLevel[] | null>(null);
  const [removed, setRemoved] = useState(false);
  const [editing, setEditing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Latches true the instant the user does anything live — once true,
  // `initialChain` is never consulted again for this field's lifetime. State
  // (not a ref) because the seeded-pin derivation below reads it during
  // render — `react-hooks/refs` forbids reading ref.current at render time.
  // Setting it alongside the other setState calls in each handler doesn't add
  // an extra render pass; React batches them into the same commit.
  const [userTouched, setUserTouched] = useState(false);
  // Live lookup is opt-in (#791): the first focus of a place field asks once.
  const geocodingChoice = useGeocodingChoice();
  const [lookupAsked, setLookupAsked] = useState(false);

  // The picker (#1186): the tree's places first, then the map's suggestions. Nothing
  // is preselected, and leaving the field keeps the text: an exact name links to its
  // place, anything else becomes a new place. The tree's places load once the field
  // has a value or is used.
  const [wanted, setWanted] = useState(value.trim() !== '');
  const options = useTreePlaceOptions(treeId, wanted);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Typed since the field last settled; the line under it waits until it settles.
  const [typing, setTyping] = useState(false);
  const [mapRows, setMapRows] = useState<PhotonCandidate[]>([]);
  const mapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapAbort = useRef<AbortController | null>(null);
  // Phone: the sheet's own copy of the text, kept only on Done.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const query = variant === 'sheet' ? draft : value;

  const runResolve = useCallback((q: string) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    resolvePlace(q, { signal: ctrl.signal })
      .then((result) => {
        if (ctrl.signal.aborted) return;
        setRemoved(false);
        setLevels(result.length > 0 ? result : null);
        onResolve?.(result.length > 0 ? result : null);
      })
      .catch((e) => { if (!ctrl.signal.aborted && (e as Error).name !== 'AbortError') { setLevels(null); onResolve?.(undefined); } });
  }, [onResolve]);

  /** A place of the tree already has its pin: no lookup, nothing to write. */
  const dropResolve = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    setLevels(null);
    setRemoved(false);
    onResolve?.(undefined);
  }, [onResolve]);

  // Map suggestions for the list, debounced, only once lookup is on (#791).
  const searchMap = useCallback((q: string) => {
    if (mapTimer.current) clearTimeout(mapTimer.current);
    mapAbort.current?.abort();
    if (!isGeocodingEnabled() || q.trim().length < 3) { setMapRows([]); return; }
    mapTimer.current = setTimeout(() => {
      const ctrl = new AbortController();
      mapAbort.current = ctrl;
      fetchCandidates(q, { signal: ctrl.signal })
        .then((found) => { if (!ctrl.signal.aborted) setMapRows(found); })
        .catch(() => { if (!ctrl.signal.aborted) setMapRows([]); });
    }, DEBOUNCE_MS);
  }, []);

  // Resolution is triggered by typing only, never by a value the field mounts
  // with (e.g. an existing record's already-saved place) — showing that
  // record's already-saved pin is a separate, cheap DB lookup deferred to a
  // follow-up plan; re-running live Photon resolution on every form open would
  // be wasted network traffic for a value that hasn't changed.
  function applyText(v: string) {
    setUserTouched(true);
    onChange(v);
    // New text names no place until it settles.
    onPlaceIdChange?.(null);
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    // A pin belongs to the previous text. Clear it before the debounce or a
    // late Photon reply can save the old coordinates under the new place name.
    setLevels(null);
    setRemoved(false);
    onResolve?.(undefined);
    if (!isGeocodingEnabled() || v.trim().length < 3) {
      return;
    }
    timer.current = setTimeout(() => runResolve(v), DEBOUNCE_MS);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    applyText(v);
    setTyping(true);
    setListOpen(true);
    setActive(-1);
    searchMap(v);
  }

  /** Text left in the field links as the server will link it. */
  function settle(text: string) {
    setTyping(false);
    if (!options) return;
    const match = settlePlaceText(options, text);
    onPlaceIdChange?.(match?.placeId ?? null);
    if (match?.pinned) dropResolve();
  }

  function pickRow(row: Row) {
    setTyping(false);
    setListOpen(false);
    setActive(-1);
    setSheetOpen(false);
    setUserTouched(true);
    if (row.kind === 'tree') {
      const o = row.option;
      if (o.pinned) {
        onChange(o.text);
        dropResolve();
      } else if (o.text !== value) {
        // A place with no pin yet still gets the usual lookup for its text.
        applyText(o.text);
      }
      onPlaceIdChange?.(o.placeId);
      return;
    }
    // A map suggestion is a new place, with its pin and region set.
    const text = row.candidate.result.name;
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    onChange(text);
    onPlaceIdChange?.(null);
    const chain = chainFromCandidate(row.candidate, text);
    setRemoved(false);
    setLevels(chain);
    onResolve?.(chain);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (mapTimer.current) clearTimeout(mapTimer.current);
      abort.current?.abort();
      mapAbort.current?.abort();
    };
  }, []);

  /** Closing always returns focus to the trigger — otherwise keyboard focus falls
   *  to <body> and the user loses their place in the form. */
  const closeEditor = useCallback(() => {
    setEditing(false);
    triggerRef.current?.focus();
  }, []);

  function handlePick(chain: HierarchyLevel[]) {
    setUserTouched(true);
    setRemoved(false);
    setLevels(chain);
    onResolve?.(chain);
    closeEditor();
  }

  function handleRemove() {
    setUserTouched(true);
    setRemoved(true);
    setLevels(null);
    onRemove?.();
    closeEditor();
  }

  // The list: the tree's places (with the other names and close spellings), then the
  // map's suggestions for names the tree doesn't have.
  const treeRows = useMemo(() => (options ? matchPlaceOptions(options, query) : []), [options, query]);
  const rows: Row[] = useMemo(() => {
    const names = new Set(options?.map((o) => o.text));
    const map = query.trim().length >= 3 ? mapRows.filter((c) => !names.has(c.result.name)).slice(0, MAP_ROWS) : [];
    return [
      ...treeRows.map((option) => ({ kind: 'tree' as const, option })),
      ...map.map((candidate) => ({ kind: 'map' as const, candidate })),
    ];
  }, [treeRows, mapRows, options, query]);

  // What the field links to now: the place the form holds, else what the text means.
  const linked = useMemo(() => {
    if (!options || !value.trim()) return null;
    if (placeId != null) {
      const held = options.find((o) => o.placeId === placeId && o.text === value.trim());
      if (held) return held;
    }
    return settlePlaceText(options, value);
  }, [options, placeId, value]);
  const sameName = linked && !linked.isOtherName ? sameNamePlaces(options ?? [], linked) : 0;

  // Seeds the badge from an already-saved chain (edit-mode pin display,
  // docs/superpowers/specs/2026-07-09-edit-mode-pin-display-design.md) —
  // derived at render time, not via an effect + setState, so mounting with an
  // initialChain shows the badge on the very first paint with no extra render
  // pass. Read-only: never persisted into `levels` state, never fires
  // onResolve, so an untouched field still writes nothing on save.
  // `userTouched` permanently blocks the seed once the user does anything live.
  const seededNodes: PinNode[] | null =
    !userTouched && levels === null && initialChain?.length ? initialChain : null;
  const effectiveNodes = levels ? levelsToNodes(levels) : seededNodes;

  const pin: ResolvedPin | null = !removed && effectiveNodes ? pinFromNodes(effectiveNodes) : null;
  // Own pin (leaf resolved its own coordinates — a confident match or an
  // explicit Edit-popover pick) vs. inherited (leaf has no coordinates of its
  // own; the pin comes from an ancestor level via resolvePin's walk-up) are
  // differentiated by MARKER SHAPE, not color alone — colorblind-accessibility
  // requirement (docs/superpowers/specs/2026-07-09-places-precision-hierarchy-
  // design.md, "Badge and pin-mark differentiate ... by shape (dot vs. dashed
  // diamond), not color alone"). Driven by resolvePin's explicit isOwnPin flag,
  // NOT a string-compare of the (now canonical) badge text to the typed value.
  const isOwnPin = pin?.isOwnPin ?? false;
  // The trigger appears as soon as there's a place to pin — as the badge when a
  // pin exists, otherwise as a "Set a map pin" link (see the JSX below). A place of
  // the tree that already has its pin keeps it; its page is where that pin changes.
  const showTrigger = value.trim().length > 0 && !(pin === null && !removed && linked?.pinned && !typing);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!listOpen) { setListOpen(true); return; }
      if (rows.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i < 0 ? (step > 0 ? 0 : rows.length - 1) : (i + step + rows.length) % rows.length));
    } else if (e.key === 'Enter') {
      // Enter confirms the highlighted row, else the typed text (Done, on a phone).
      e.preventDefault();
      e.stopPropagation();
      if (listOpen && active >= 0 && rows[active]) pickRow(rows[active]);
      else if (variant === 'sheet') finishSheet();
      else { setListOpen(false); settle(value); }
    } else if (e.key === 'Escape' && listOpen && variant === 'inline') {
      e.stopPropagation();
      setListOpen(false);
      setActive(-1);
    }
  }

  function openSheet() {
    setWanted(true);
    setDraft(value);
    setActive(-1);
    setSheetOpen(true);
    searchMap(value);
  }

  // Done keeps what was typed, as leaving the field does on a desktop.
  function finishSheet() {
    setSheetOpen(false);
    if (draft !== value) applyText(draft);
    settle(draft);
  }

  const list = (floating: boolean) => (
    <div
      id={listId}
      role="listbox"
      aria-label={label ?? placeholder}
      // Keeps focus in the text box while a row is clicked.
      onMouseDown={(e) => e.preventDefault()}
      className={floating ? 'card absolute left-0 right-0 z-50 mt-1 p-1 max-h-[330px] overflow-y-auto' : 'mt-2 -mx-1'}
    >
      {treeRows.length > 0 && (
        <div role="group" aria-labelledby={`${listId}-tree`}>
          <div id={`${listId}-tree`} role="presentation" className="px-2.5 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">{t('in_your_tree')}</div>
          {rows.map((row, i) => row.kind === 'tree' && <OptionRow key={`t${i}`} id={`${listId}-${i}`} active={i === active} onPick={() => pickRow(row)} option={row.option} query={query} roomy={!floating} />)}
        </div>
      )}
      {rows.some((r) => r.kind === 'map') && (
        <div role="group" aria-labelledby={`${listId}-map`}>
          <div id={`${listId}-map`} role="presentation" className="px-2.5 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">{t('from_the_map')}</div>
          {rows.map((row, i) => row.kind === 'map' && (
            <div
              key={`m${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onClick={() => pickRow(row)}
              className={cx('flex items-start gap-2.5 rounded-md px-2.5 cursor-pointer hover:bg-surface', floating ? 'py-2' : 'py-3 min-h-[52px]', i === active && 'bg-surface')}
            >
              <Globe size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-text-muted" />
              <span className="grid min-w-0">
                <span className="serif text-base text-text truncate">{shortName(row.candidate.result.name)}</span>
                <span className="text-meta text-text-muted truncate">{row.candidate.result.name.split(',').slice(1).join(',').trim()}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {rows.length === 0 && query.trim() !== '' && options && (
        <p className="m-0 px-2.5 py-2 text-meta text-text-muted">{t('nothing_found')}</p>
      )}
    </div>
  );

  // What the text links to, once it has settled: the place, the other name it was
  // written as, or a new place.
  const status = !typing && value.trim() && options ? (
    <div className="mt-[6px] flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta leading-[1.4] text-[color:var(--color-text-muted)]">
      {linked?.isOtherName ? (
        <>
          <Tag size={12} aria-hidden="true" className="shrink-0" />
          <span>{t('written_as', { name: linked.text, place: linked.placeName })}</span>
        </>
      ) : linked ? (
        <>
          <span>{linked.parentName ? t('place_in', { place: linked.placeName, parent: linked.parentName }) : linked.placeName}</span>
          {sameName > 1 && (
            <button
              type="button"
              className="text-link underline underline-offset-2 [@media(pointer:coarse)]:min-h-[44px]"
              onClick={() => {
                if (variant === 'sheet') { openSheet(); return; }
                setWanted(true);
                setListOpen(true);
                inputRef.current?.focus();
              }}
            >
              {t('not_this', { place: shortName(linked.placeName) })}
            </button>
          )}
        </>
      ) : (
        <span>{t('new_place')}</span>
      )}
    </div>
  ) : null;

  return (
    <div style={{ position: 'relative' }}>
      {variant === 'sheet' ? (
        <>
          <button
            id={id}
            type="button"
            aria-haspopup="dialog"
            onClick={openSheet}
            className={cx(className, 'flex items-center justify-between gap-2 text-left')}
          >
            <span className={cx('truncate', !value && 'text-text-muted')}>{value || placeholder}</span>
            <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-text-muted" />
          </button>
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={label ?? placeholder ?? ''} size="full"
            dirty={draft !== value} onSave={finishSheet} saveLabel={t('done')} saveWhenClean>
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              aria-label={label ?? placeholder}
              value={draft}
              placeholder={placeholder}
              onChange={(e) => { setDraft(e.target.value); setActive(-1); searchMap(e.target.value); }}
              onFocus={() => { if (geocodingChoice === null) setLookupAsked(true); }}
              onKeyDown={onKeyDown}
              className={cx(className, 'w-full')}
              {...noAutofill('place')}
            />
            {lookupAsked && geocodingChoice === null && (
              <GeocodingPrompt onEnabled={() => searchMap(draft)} />
            )}
            {list(false)}
          </Sheet>
        </>
      ) : (
        <>
          <input
            ref={inputRef}
            id={id}
            type="text"
            role="combobox"
            aria-expanded={listOpen && rows.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={listOpen && active >= 0 ? `${listId}-${active}` : undefined}
            aria-label={label}
            className={className}
            value={value}
            placeholder={placeholder}
            onChange={handleChange}
            onKeyDown={onKeyDown}
            onFocus={() => { setWanted(true); if (geocodingChoice === null) setLookupAsked(true); }}
            // Tab or a click away keeps the text (an exact name links to its place).
            onBlur={() => { setListOpen(false); setActive(-1); if (typing) settle(value); }}
            {...noAutofill('place')}
          />
          {listOpen && (rows.length > 0 || (query.trim() !== '' && options)) && list(true)}
        </>
      )}
      {lookupAsked && geocodingChoice === null && variant === 'inline' && (
        <GeocodingPrompt onEnabled={() => { if (value.trim().length >= 3) runResolve(value); }} />
      )}
      {status}
      {/* Pinned → the badge names what it resolved to, plus an Edit link.
          Not pinned → no badge and no bare "EDIT" beside nothing, but a quiet
          "Set a map pin" link, because the popover is still the only way to reach
          manual lat/lng for a place Photon cannot resolve, and the only way to
          undo a Remove pin without retyping the field.
          Either way the trigger stays visible while the popover is open: it names
          the current pin, which is the question that made the user open it, so the
          popover needs no header of its own. */}
      {showTrigger && (
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={editing}
          onClick={() => setEditing((v) => !v)}
          className="mt-[6px] gap-[6px] text-meta leading-[1.4] [@media(pointer:coarse)]:min-h-[44px]"
          style={{
            display: 'flex', alignItems: 'center',
            cursor: 'pointer', background: 'none', border: 'none', padding: 0, textAlign: 'left',
            // fontFamily, NOT the `font` shorthand — `font: inherit` resets font-size,
            // which silently discarded the 12.5px above and let the badge inherit the
            // field's font size, making this secondary metadata read as primary text.
            // --color-*, not the root --text-muted alias, so the caption follows a dark
            // island's override (the family hero editor, #759).
            color: 'var(--color-text-muted)', fontFamily: 'inherit',
          }}
        >
          {pin ? (
            <>
              {/* One geocode-state symbol set across the app (#266): own = map pin,
                  inherited = dashed diamond. This badge drew "own" as a filled dot,
                  which is a shape the Places surfaces do not use at all — same
                  meaning, second vocabulary. The dashed diamond was already shared,
                  and `data-pin-kind` still carries the state for tests. */}
              {isOwnPin ? (
                <span aria-hidden="true" data-pin-kind="own" className="inline-flex shrink-0 text-[color:var(--color-link)]">
                  <MapPin size={12} />
                </span>
              ) : (
                // The same utility string PinMark uses for this state, so the two
                // diamonds cannot drift apart.
                <span
                  aria-hidden="true"
                  data-pin-kind="inherited"
                  className="inline-block w-2 h-2 rotate-45 border border-dashed border-[color:var(--color-link)] shrink-0"
                />
              )}
              <span>{t('map_pinned_to', { place: pin.displayName })}</span>
              {/* A normal text link (#761), not a bold uppercase tag. */}
              <span className="text-link underline underline-offset-2">{t('edit')}</span>
            </>
          ) : (
            /* Ink + a leading plus, so it reads as an action rather than a
               caption. Muted body text here looked like an inert note. */
            <>
              <Plus size={13} aria-hidden="true" style={{ color: 'var(--color-link)', flexShrink: 0 }} />
              <span className="font-semibold" style={{ color: 'var(--color-link)' }}>{t('set_map_pin')}</span>
            </>
          )}
        </button>
      )}
      {editing && (
        <EditPinPopover
          leafName={value}
          treeId={treeId}
          anchorRef={triggerRef}
          onPick={handlePick}
          onRemove={handleRemove}
          onClose={closeEditor}
        />
      )}
    </div>
  );
}

/** A row of "In your tree": the place or other name, what tells it apart, its records. */
function OptionRow({ id, option, active, onPick, query, roomy }: {
  id: string;
  option: PlaceMatch;
  active: boolean;
  onPick: () => void;
  query: string;
  roomy: boolean;
}) {
  const t = useTranslations('locationField');
  const where = option.parentName ? t('part_of', { place: option.parentName }) : option.displayName;
  const sub = [
    option.close ? t('close_spelling') : null,
    option.isOtherName ? t('other_name_of', { place: option.placeName }) : null,
    where,
  ].filter(Boolean).join(' · ');
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      onClick={onPick}
      className={cx('flex items-start gap-2.5 rounded-md px-2.5 cursor-pointer hover:bg-surface', roomy ? 'py-3 min-h-[52px]' : 'py-2', active && 'bg-surface')}
    >
      {option.isOtherName
        ? <Tag size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-text-muted" />
        : <MapPin size={16} aria-hidden="true" className={cx('mt-0.5 shrink-0', option.pinned ? 'text-[color:var(--color-link)]' : 'text-text-muted')} />}
      <span className="grid flex-1 min-w-0">
        <span className="serif text-base text-text truncate"><Highlight text={option.text} query={query} /></span>
        {sub && <span className="text-meta text-text-muted truncate">{sub}</span>}
      </span>
      <span className="mt-0.5 shrink-0 font-mono text-meta text-text-muted">{option.count}</span>
    </div>
  );
}

/** The typed part of a name, marked. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = foldForSearch(query.trim());
  const at = q ? foldForSearch(text).indexOf(q) : -1;
  // Folding keeps one code unit per letter for the scripts names use, so the
  // folded index is the original's.
  if (at < 0 || foldForSearch(text).length !== text.length) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="bg-border text-text rounded-[3px] px-px">{text.slice(at, at + q.length)}</mark>{text.slice(at + q.length)}</>;
}

function EditPinPopover({
  leafName, treeId, anchorRef, onPick, onRemove, onClose,
}: {
  leafName: string;
  treeId?: number | null;
  /** The badge/Edit trigger. Clicks on it must not be treated as "outside" —
   *  otherwise the outside-close and the trigger's own toggle fight each other. */
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onPick: (chain: HierarchyLevel[]) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('locationField');
  const geocodingChoice = useGeocodingChoice();
  const [dependentCount, setDependentCount] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<PhotonCandidate[]>([]);
  const [showCoords, setShowCoords] = useState(false);
  const [coordsInput, setCoordsInput] = useState('');
  const [coordsError, setCoordsError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await getDataClient();
        const count = await client.places.dependentCount(leafName, treeId);
        if (!cancelled) setDependentCount(count);
      } catch {
        if (!cancelled) setDependentCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, [leafName, treeId]);

  useEffect(() => {
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  function search(v: string) {
    if (timer.current) clearTimeout(timer.current);
    // Nothing goes to the geocoder until the user has opted in (#791).
    if (!isGeocodingEnabled() || v.trim().length < 3) { setCandidates([]); return; }
    timer.current = setTimeout(async () => {
      try {
        setCandidates(await fetchCandidates(v));
      } catch {
        setCandidates([]);
      }
    }, 350);
  }

  function handleSearchChange(v: string) {
    setQuery(v);
    search(v);
  }

  function handleCoordsSave() {
    const parsed = parseCoords(coordsInput);
    if (!parsed) { setCoordsError(t('invalid_coords')); return; }
    onPick([{ name: leafName, latitude: parsed.latitude, longitude: parsed.longitude }]);
  }

  // Esc and click-outside close the popover — that's why there is no "Close" link.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (boxRef.current && !boxRef.current.contains(target)) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    // `mousedown` fires before the candidate rows' own click, but they live inside
    // boxRef so the containment check below already spares them — no race.
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [onClose, anchorRef]);

  return (
    <div ref={boxRef} className="card z-50 mt-1 p-[10px] text-sm" style={{ position: 'absolute', left: 0, right: 0 }}>
      {!showCoords ? (
        <>
          <Input
            size="sm"
            autoFocus
            icon={<Search size={14} aria-hidden="true" />}
            placeholder={t('search_placeholder')}
            aria-label={t('search_placeholder')}
            value={query}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
          {geocodingChoice === null && <GeocodingPrompt onEnabled={() => search(query)} />}
          {geocodingChoice === 'off' && <p className="mt-2 text-meta text-text-muted">{t('lookup_off')}</p>}
          {candidates.length > 0 && (
            <div className="mt-1 max-h-[176px]" style={{ overflowY: 'auto' }}>
              {candidates.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  className="pin-candidate"
                  // onClick, not onMouseDown: a keyboard Enter/Space on a focused
                  // button fires `click` only. These rows carry a focus ring, so
                  // they must actually be operable from the keyboard.
                  onClick={() => onPick(chainFromCandidate(c, leafName))}
                >
                  {c.result.name}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <Input
            size="sm"
            autoFocus
            placeholder={t('coords_placeholder')}
            aria-label={t('coords_label')}
            value={coordsInput}
            onChange={(e) => { setCoordsInput(e.target.value); setCoordsError(null); }}
          />
          {coordsError && <div className="text-meta mt-1" style={{ color: 'var(--error)' }}>{coordsError}</div>}
          <Button type="button" size="sm" onClick={handleCoordsSave} className="mt-2">
            {t('save')}
          </Button>
        </>
      )}

      {dependentCount != null && dependentCount > 0 && (
        <div className="muted text-meta mt-2">
          {t('dependent_notice', { count: dependentCount })}
        </div>
      )}

      {/* Footer: a neutral mode-toggle and a destructive action, visually distinct.
          Amber is reserved for dates/citations, so neither uses it. */}
      <div className="pin-popover-footer">
        <button type="button" className="pin-footer-action" onClick={() => { setShowCoords((v) => !v); setCoordsError(null); }}>
          {showCoords ? t('back_to_search') : t('enter_coords_link')}
        </button>
        <button type="button" className="pin-footer-action pin-footer-action--danger" onClick={onRemove}>
          {t('remove_pin_link')}
        </button>
      </div>
    </div>
  );
}
