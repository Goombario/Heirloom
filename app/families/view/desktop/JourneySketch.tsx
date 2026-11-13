import { cx } from '@/app/components/ui/cx';

/** One stop on the sketch: where, and the year it was recorded there (if any). */
interface SketchStop {
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

/**
 * The family rail's journey sketch (fix 13): the family's places in date order,
 * drawn as a dashed copper line through dots on a plain tint. It needs no map
 * tiles, so it reads the same offline. The last stop is filled. It is a picture:
 * the caller wraps it in the button that opens the full journey map.
 */
export default function JourneySketch({ stops, className }: { stops: SketchStop[]; className?: string }) {
  // Consecutive records at the same place are one stop.
  const path = stops.filter((s, i) => i === 0 || s.label !== stops[i - 1].label);
  if (path.length === 0) return null;

  const lats = path.map((s) => s.lat);
  const lngs = path.map((s) => s.lng);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  // Keep the shape's proportions (roughly, at these scales) and centre it.
  const spanLng = Math.max(maxLng - minLng, 1e-6);
  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min((W - 2 * PAD_X) / spanLng, (H - 2 * PAD_Y) / spanLat);
  const single = maxLng - minLng < 1e-6 && maxLat - minLat < 1e-6;
  const offX = (W - spanLng * scale) / 2;
  const offY = (H - spanLat * scale) / 2;
  const pts = path.map((s) => single
    ? { x: W / 2, y: H / 2 }
    : { x: offX + (s.lng - minLng) * scale, y: H - (offY + (s.lat - minLat) * scale) });

  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const labelled = (i: number) => path.length <= LABEL_ALL_UP_TO || i === 0 || i === path.length - 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className={cx('journey-sketch block rounded-card', className)} aria-hidden="true">
      {pts.length > 1 && <path d={d} className="journey-sketch__line" fill="none" strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" />}
      {pts.map((p, i) => {
        const last = i === pts.length - 1;
        return <circle key={i} cx={p.x} cy={p.y} r={last ? 6 : 5} strokeWidth="2" className={last ? 'journey-sketch__end' : 'journey-sketch__stop'} />;
      })}
      {pts.map((p, i) => {
        if (!labelled(i)) return null;
        const s = path[i];
        const right = p.x < W * 0.6;
        const below = p.y < 22;
        return (
          <text key={`t${i}`} x={p.x + (right ? 9 : -9)} y={below ? p.y + 18 : p.y - 9} textAnchor={right ? 'start' : 'end'} className="journey-sketch__label">
            {s.label.split(',')[0]}{s.year ? ` ${s.year}` : ''}
          </text>
        );
      })}
    </svg>
  );
}
