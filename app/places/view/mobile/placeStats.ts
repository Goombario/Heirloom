// The numbers behind the phone place page's Records and Years panels (#1118), worked
// out from the one-row-per-fact payload the place detail already ships. Pure and
// separately tested, like `groupFactLinks.ts`.

import type { PlaceFactLinkEntry } from '@/lib/data/types';

/** The year a stored date names, or null. Stored dates come in three shapes (ISO
 *  partials, raw GEDCOM "14 JUN 1921", qualified "ABT 1876"); each carries its year
 *  as the first four-digit run. */
export function yearOf(date: string | null | undefined): number | null {
  const y = date?.match(/\d{4}/)?.[0];
  return y ? Number(y) : null;
}

/** The GEDCOM type a fact counts under: births, deaths and marriages by their kind. */
function factType(link: Pick<PlaceFactLinkEntry, 'kind' | 'eventType'>): string {
  if (link.kind === 'birth') return 'BIRT';
  if (link.kind === 'death') return 'DEAT';
  if (link.kind === 'marriage') return 'MARR';
  return link.eventType ?? 'EVEN';
}

export interface RecordGroup {
  type: string;
  count: number;
  /** Everyone the type covers, in the order they first appear, each once. */
  names: string[];
  first: number | null;
  last: number | null;
}

/** One group per event type, the busiest first; ties keep the order they first appear. */
export function recordGroups(links: PlaceFactLinkEntry[]): RecordGroup[] {
  const groups = new Map<string, RecordGroup>();
  for (const link of links) {
    const type = factType(link);
    let g = groups.get(type);
    if (!g) {
      g = { type, count: 0, names: [], first: null, last: null };
      groups.set(type, g);
    }
    g.count++;
    if (link.name && !g.names.includes(link.name)) g.names.push(link.name);
    const y = yearOf(link.date);
    if (y != null) {
      g.first = g.first == null ? y : Math.min(g.first, y);
      g.last = g.last == null ? y : Math.max(g.last, y);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** "1846–1955", "1890" for one year, or '' with no dated record. */
export function yearSpan(first: number | null, last: number | null): string {
  if (first == null || last == null) return '';
  return first === last ? String(first) : `${first}–${last}`;
}

export interface YearStats {
  /** Every decade from the first to the last record, empty ones included. */
  decades: { decade: number; count: number }[];
  busiest: { decade: number; count: number } | null;
  first: { link: PlaceFactLinkEntry; year: number } | null;
  last: { link: PlaceFactLinkEntry; year: number } | null;
  undated: number;
}

export function yearStats(links: PlaceFactLinkEntry[]): YearStats {
  const dated = links
    .map((link) => ({ link, year: yearOf(link.date) }))
    .filter((d): d is { link: PlaceFactLinkEntry; year: number } => d.year != null)
    .sort((a, b) => a.year - b.year);
  const undated = links.length - dated.length;
  if (dated.length === 0) return { decades: [], busiest: null, first: null, last: null, undated };
  const tally = new Map<number, number>();
  for (const d of dated) {
    const decade = Math.floor(d.year / 10) * 10;
    tally.set(decade, (tally.get(decade) ?? 0) + 1);
  }
  const from = Math.floor(dated[0].year / 10) * 10;
  const to = Math.floor(dated[dated.length - 1].year / 10) * 10;
  const decades: YearStats['decades'] = [];
  let busiest: YearStats['busiest'] = null;
  for (let decade = from; decade <= to; decade += 10) {
    const count = tally.get(decade) ?? 0;
    decades.push({ decade, count });
    if (count > 0 && (busiest == null || count > busiest.count)) busiest = { decade, count };
  }
  return { decades, busiest, first: dated[0], last: dated[dated.length - 1], undated };
}

/** The years labelled under the decade columns: every 50, or the two ends when the
 *  span holds fewer than two of those. */
export function decadeTicks(from: number, to: number): number[] {
  const ticks: number[] = [];
  for (let d = Math.ceil(from / 50) * 50; d <= to; d += 50) ticks.push(d);
  return ticks.length >= 2 ? ticks : from === to ? [from] : [from, to];
}
