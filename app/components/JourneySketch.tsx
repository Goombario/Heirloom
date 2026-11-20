'use client';

import { useEffect, useMemo, useState } from 'react';
import { cx } from '@/app/components/ui/cx';
import { loadBasemap, type Basemap, type BasemapShape } from './journeyBasemap';

/** One stop on the sketch: where, and the year it was recorded there (if any). */
export interface SketchStop {
  lat: number;
  lng: number;
  label: string;
  year: string | null;
}

const W = 260;
const H = 150;
const PAD_X = 34;
const PAD_Y = 26;
/** Beyond this many stops only the first and last are labelled, so names don't pile up. */
const LABEL_ALL_UP_TO = 4;
/** The narrowest view, in degrees of latitude, so one town still shows its coast and neighbours. */
const MIN_SPAN_DEG = 5;
/** Points closer than this on screen are dropped from a coastline, to keep the paths short. */
const MIN_STEP_PX = 0.6;

/** Fits the stops into the box: a flat projection with longitude shrunk by the middle latitude. */
function fitView(path: SketchStop[]) {
  const lats = path.map((s) => s.lat);
  const lngs = path.map((s) => s.lng);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const k = Math.max(Math.cos(((minLat + maxLat) / 2) * Math.PI / 180), 0.2);
  const cx0 = ((minLng + maxLng) / 2) * k;
  const cy0 = (minLat + maxLat) / 2;
  const spanX = Math.max((maxLng - minLng) * k, MIN_SPAN_DEG * (W / H));
  const spanY = Math.max(maxLat - minLat, MIN_SPAN_DEG);
  const scale = Math.min((W - 2 * PAD_X) / spanX, (H - 2 * PAD_Y) / spanY);
  const x = (lng: number) => W / 2 + (lng * k - cx0) * scale;
  const y = (lat: number) => H / 2 - (lat - cy0) * scale;
  // The geographic box the picture shows, for culling the basemap.
  const halfLng = W / 2 / scale / k;
  const halfLat = H / 2 / scale;
  const bounds = { minLng: cx0 / k - halfLng, maxLng: cx0 / k + halfLng, minLat: cy0 - halfLat, maxLat: cy0 + halfLat };
  return { x, y, bounds };
}

type View = ReturnType<typeof fitView>;

function shapesPath(shapes: BasemapShape[], view: View, close: boolean): string {
  const { x, y, bounds: b } = view;
  let d = '';
  for (const s of shapes) {
    if (s.maxLng < b.minLng || s.minLng > b.maxLng || s.maxLat < b.minLat || s.minLat > b.maxLat) continue;
    let lastX = NaN, lastY = NaN, lastLng = NaN, part = '';
    for (const [lng, lat] of s.points) {
      const px = x(lng), py = y(lat);
      if (part && Math.abs(px - lastX) < MIN_STEP_PX && Math.abs(py - lastY) < MIN_STEP_PX) continue;
      // A ring that crosses the antimeridian jumps from 180 to -180: start a new piece
      // there rather than draw a stripe across the whole picture.
      const jump = Math.abs(lng - lastLng) > 180;
      part += `${part && !jump ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
      lastX = px; lastY = py; lastLng = lng;
    }
    d += part + (close && part ? 'Z' : '');
  }
  return d;
}

/** Rough width of the 10px label font, per character, for keeping labels apart and in the box. */
const CHAR_PX = 5.6;

/**
 * Labels for the first and last stops (every stop when there are only a few), the last
 * placed first. A label that would overlap one already placed is left out, and one
 * that would run off the side flips to the other side of its dot.
 */
function placeLabels(path: SketchStop[], pts: { x: number; y: number }[]) {
  const wanted = path.map((_, i) => i)
    .filter((i) => path.length <= LABEL_ALL_UP_TO || i === 0 || i === path.length - 1)
    .reverse();
  const placed: { i: number; x: number; y: number; anchor: 'start' | 'end'; text: string; box: [number, number, number, number] }[] = [];
  for (const i of wanted) {
    const s = path[i];
    const p = pts[i];
    const text = `${s.label.split(',')[0]}${s.year ? ` ${s.year}` : ''}`;
    const w = text.length * CHAR_PX;
    let right = p.x < W * 0.6;
    if (right && p.x + 9 + w > W - 4) right = false;
    else if (!right && p.x - 9 - w < 4) right = true;
    const x = p.x + (right ? 9 : -9);
    const y = p.y < 22 ? p.y + 18 : p.y - 9;
    const left = right ? x : x - w;
    const box: [number, number, number, number] = [left, y - 9, left + w, y + 2];
    if (placed.some(({ box: b }) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) continue;
    placed.push({ i, x, y, anchor: right ? 'start' : 'end', text, box });
  }
  return placed;
}

/** The bundled outline map, once it has loaded; null before then or if it can't load. */
function useBasemap(): Basemap | null {
  const [map, setMap] = useState<Basemap | null>(null);
  useEffect(() => {
    let live = true;
    loadBasemap().then((m) => { if (live) setMap(m); }, () => { /* the route still draws on the plain tint */ });
    return () => { live = false; };
  }, []);
  return map;
}

/**
 * The rail's journey map on the person and family pages: the places in date order,
 * drawn as a dashed copper line through dots over a real outline map (coastlines and
 * country borders from the bundled Natural Earth data). It needs no map tiles, so it
 * reads the same offline and in the desktop app; until the outline loads the route
 * sits on the plain sea tint. The last stop is filled. It is a picture: the caller
 * wraps it in the button that opens the full journey map.
 */
export default function JourneySketch({ stops, className }: { stops: SketchStop[]; className?: string }) {
  // Consecutive records at the same place are one stop.
  const path = useMemo(() => stops.filter((s, i) => i === 0 || s.label !== stops[i - 1].label), [stops]);
  const view = useMemo(() => (path.length > 0 ? fitView(path) : null), [path]);
  const basemap = useBasemap();
  const land = useMemo(() => (basemap && view ? shapesPath(basemap.land, view, true) : ''), [basemap, view]);
  const borders = useMemo(() => (basemap && view ? shapesPath(basemap.borders, view, false) : ''), [basemap, view]);
  if (!view) return null;

  const pts = path.map((s) => ({ x: view.x(s.lng), y: view.y(s.lat) }));
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const labels = placeLabels(path, pts);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className={cx('journey-sketch block rounded-card', className)} aria-hidden="true">
      {land && <path d={land} className="journey-sketch__land" fillRule="evenodd" />}
      {borders && <path d={borders} className="journey-sketch__border" fill="none" strokeWidth="0.75" strokeLinejoin="round" />}
      {pts.length > 1 && <path d={d} className="journey-sketch__line" fill="none" strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" />}
      {pts.map((p, i) => {
        const last = i === pts.length - 1;
        return <circle key={i} cx={p.x} cy={p.y} r={last ? 6 : 5} strokeWidth="2" className={last ? 'journey-sketch__end' : 'journey-sketch__stop'} />;
      })}
      {labels.map((l) => (
        <text key={`t${l.i}`} x={l.x} y={l.y} textAnchor={l.anchor} className="journey-sketch__label">{l.text}</text>
      ))}
    </svg>
  );
}
