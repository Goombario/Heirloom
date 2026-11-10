'use client';

// "Geocoded as" is the geocoder's own name for whatever it matched — provenance, not
// user text (ADR 0017). So the fix for a WRONG match is not to let the field be typed
// into; it is to run the match again and pick a different result. That is this control.
//
// It reuses LocationField's picker machinery (fetchCandidates + chainFromCandidate), so
// a re-match here and a pin pick in a person form resolve through exactly the same code.
// The panel expands INLINE rather than floating: it lives in the detail rail, which
// scrolls, and an absolutely-positioned popover in a scroll container clips.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fetchCandidates, type PhotonCandidate } from '@/lib/geocode/photon';
import { isGeocodingEnabled } from '@/lib/geocode/prefs';
import { useGeocodingChoice } from '@/app/hooks/useGeocodingChoice';
import GeocodingPrompt from '@/app/components/GeocodingPrompt';
import { Button } from '@/app/components/ui/Button';
import { Input } from '@/app/components/ui/Input';
import { Search } from '@/lib/icons';

const DEBOUNCE_MS = 350;
const MIN_QUERY_LEN = 3;

export interface PlaceRematchProps {
  /** Seeds the search, because the current name is the most likely thing to re-search. */
  placeName: string;
  /** Fires with the picked candidate. The caller owns the write and the refetch. */
  onPick: (candidate: PhotonCandidate) => void;
  /** A write is in flight — the panel closes on success, so this only disables re-picking. */
  busy?: boolean;
}

export default function PlaceRematch({ placeName, onPick, busy = false }: PlaceRematchProps) {
  const t = useTranslations('places');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(placeName);
  const [candidates, setCandidates] = useState<PhotonCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  /** The query is too short to search at all — distinct from "searched, found nothing",
   *  which would otherwise advise the user to try something *shorter*. */
  const [tooShort, setTooShort] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  // Closing always returns focus to the trigger — otherwise it falls to <body> and a
  // keyboard user loses their place in the form.
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.querySelector('button')?.focus();
  }, []);

  /** Fire one search, superseding any in flight. Driven from the handlers rather
   *  than from an effect on `query`: the search is a reaction to a user action, not
   *  a synchronisation of state, and an effect here sets state on every render pass. */
  const runSearch = useCallback((raw: string) => {
    abort.current?.abort();
    const q = raw.trim();
    if (!isGeocodingEnabled() || q.length < MIN_QUERY_LEN) {
      setCandidates([]);
      setSearching(false);
      setFailed(false);
      setTooShort(isGeocodingEnabled() && q.length < MIN_QUERY_LEN);
      return;
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setSearching(true);
    setFailed(false);
    setTooShort(false);
    fetchCandidates(q, { signal: ctrl.signal })
      .then((results) => { setCandidates(results); setSearching(false); })
      .catch((e) => {
        // An abort is a newer keystroke superseding this one, not a failure —
        // reporting it would flash "no matches" between every two characters.
        if ((e as Error).name === 'AbortError') return;
        setCandidates([]);
        setFailed(true);
        setSearching(false);
      });
  }, []);

  /** Opening searches the current name straight away, with no debounce: seeing what
   *  the geocoder thinks "Dover" is IS the question the button was pressed to ask. */
  function handleToggle() {
    if (open) { close(); return; }
    setOpen(true);
    setQuery(placeName);
    runSearch(placeName);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      abort.current?.abort();
    };
  }, []);

  /** Escape closes the PICKER, not the whole edit form. Scoped to the panel and
   *  stopped there rather than listened for on `document`: PlaceDetailView keeps its
   *  own document-level Escape handler that cancels editing, and two listeners on the
   *  same target both fire — so one Escape in the picker also threw away every
   *  buffered coordinate edit behind it. */
  function handlePanelKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  }

  // Opt-in (#791): opening the picker is the first time a lookup would help, so
  // an unanswered choice gets the one-time prompt; a 'no' gets the off note.
  const geocodingChoice = useGeocodingChoice();

  return (
    <div className="mt-2">
      {/* Wrapper span, because `Button` does not forward a ref — the same way
          PlaceDetailView holds its Edit button to restore focus. */}
      <span ref={triggerRef}>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          disabled={busy}
          onClick={handleToggle}
          icon={<Search size={13} aria-hidden="true" />}
        >
          {t('rematch')}
        </Button>
      </span>

      {open && (
        <div className="mt-2 rounded-md border border-border bg-card p-2.5" onKeyDown={handlePanelKeyDown}>
          <p className="text-xs text-text-muted mb-2">{t('rematch_help')}</p>
          {geocodingChoice === null ? (
            <GeocodingPrompt onEnabled={() => runSearch(query)} />
          ) : geocodingChoice === 'off' ? (
            <p className="text-xs text-text-muted italic">{t('rematch_geocoding_off')}</p>
          ) : (
            <>
              <Input
                size="sm"
                autoFocus
                icon={<Search size={14} aria-hidden="true" />}
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder={t('rematch_search_placeholder')}
                aria-label={t('rematch_search_placeholder')}
              />
              <div className="mt-1.5" aria-live="polite">
                {searching ? (
                  <p className="text-xs text-text-muted italic">{t('rematch_searching')}</p>
                ) : failed ? (
                  // The SEARCH failed, which is not the same as the re-match failing —
                  // nothing was written, so the copy must not say a place could not be
                  // re-matched. That message belongs to the caller's write path.
                  <p className="text-xs text-text-muted italic">{t('rematch_search_failed')}</p>
                ) : tooShort ? (
                  <p className="text-xs text-text-muted italic">{t('rematch_type_more')}</p>
                ) : candidates.length === 0 ? (
                  <p className="text-xs text-text-muted italic">{t('rematch_no_results')}</p>
                ) : (
                  <div className="max-h-[180px] overflow-y-auto scroll-area">
                    {candidates.map((c, i) => (
                      <button
                        key={`${c.result.osmType ?? ''}-${c.result.osmId ?? i}`}
                        type="button"
                        disabled={busy}
                        // onClick, not onMouseDown: these rows carry a focus ring and a
                        // keyboard Enter on a focused button fires `click` only.
                        onClick={() => { onPick(c); close(); }}
                        className="w-full text-left px-2 py-2 min-h-[44px] rounded text-xs text-text hover:bg-[color:var(--color-hover-surface)] transition-colors disabled:opacity-60 focus-ring"
                      >
                        {c.result.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
