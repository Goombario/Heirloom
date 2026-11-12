import { sortableYear } from '@/lib/date-utils';
import type { PlaceFactLinkEntry } from '@/lib/data/types';

/** One record at a place: a birth, death, marriage or event, with everyone it names. */
export interface PlaceRecord {
    key: string;
    kind: PlaceFactLinkEntry['kind'];
    /** GEDCOM type: BIRT, DEAT, MARR or the event's own. */
    type: string;
    date: string | null;
    year: number | null;
    recordId: number;
    placeId: number;
    placeName: string;
    people: { id: number; name: string; sex: string | null; mediaId: number | null }[];
}

/** The type chips of What happened here (#56). A type in no group is under All only. */
export const CHIP_GROUPS = {
    births: ['BIRT', 'BAPM', 'CHR'],
    residence: ['RESI'],
    marriages: ['MARR', 'ENGA', 'MARB', 'MARC', 'MARL', 'MARS', 'DIV', 'DIVF', 'ANUL', 'SEPA'],
    deaths: ['DEAT', 'BURI'],
    migration: ['EMIG', 'IMMI', 'NATU'],
    census: ['CENS'],
} as const;
export type ChipGroup = keyof typeof CHIP_GROUPS;

const KIND_TYPE = { birth: 'BIRT', death: 'DEAT', marriage: 'MARR' } as const;

/**
 * The fact links grouped into records: a marriage names both partners on one row.
 * Dated records come first by year (an "about" or "before" date sorts by its year
 * and keeps its words), then the undated ones.
 */
export function placeRecords(links: readonly PlaceFactLinkEntry[]): PlaceRecord[] {
    const byKey = new Map<string, PlaceRecord>();
    for (const l of links) {
        const key = `${l.kind}:${l.recordId}:${l.placeId}`;
        let rec = byKey.get(key);
        if (!rec) {
            rec = {
                key,
                kind: l.kind,
                type: l.kind === 'event' ? (l.eventType ?? 'EVEN') : KIND_TYPE[l.kind],
                date: l.date,
                year: sortableYear(l.date),
                recordId: l.recordId,
                placeId: l.placeId,
                placeName: l.placeName,
                people: [],
            };
            byKey.set(key, rec);
        }
        if (!rec.people.some((p) => p.id === l.personId)) {
            rec.people.push({ id: l.personId, name: l.name, sex: l.sex, mediaId: l.primaryMediaId });
        }
    }
    return Array.from(byKey.values()).sort((a, b) => {
        if (a.year == null || b.year == null) return a.year == null ? (b.year == null ? 0 : 1) : -1;
        return a.year - b.year;
    });
}

export function chipGroupOf(type: string): ChipGroup | null {
    for (const [group, types] of Object.entries(CHIP_GROUPS) as [ChipGroup, readonly string[]][]) {
        if (types.includes(type)) return group;
    }
    return null;
}

/** A run of decades in the chronicle: one with records shown, or a quiet stretch folded onto the dotted rail. */
export type DecadeBlock =
    | { kind: 'decade'; decade: number; records: PlaceRecord[] }
    | { kind: 'quiet'; from: number; to: number; records: PlaceRecord[] };

/** Records per decade at or under this count fold when the chronicle is long. */
const QUIET_MAX = 2;
/** The chronicle folds quiet decades only past this many dated records. */
const FOLD_FROM = 12;

/**
 * The By decade chronicle's blocks, oldest first. Empty decades always fold onto
 * the dotted rail; in a long chronicle, decades with only one or two records fold
 * too, behind "Show N records". Neighbouring folds join into one stretch.
 */
export function decadeBlocks(dated: readonly PlaceRecord[]): DecadeBlock[] {
    if (dated.length === 0) return [];
    const byDecade = new Map<number, PlaceRecord[]>();
    for (const r of dated) {
        const d = Math.floor(r.year! / 10) * 10;
        byDecade.set(d, [...(byDecade.get(d) ?? []), r]);
    }
    const decades = [...byDecade.keys()].sort((a, b) => a - b);
    const first = decades[0]!;
    const last = decades[decades.length - 1]!;
    const foldQuiet = dated.length > FOLD_FROM;
    const blocks: DecadeBlock[] = [];
    for (let d = first; d <= last; d += 10) {
        const records = byDecade.get(d) ?? [];
        const quiet = records.length === 0 || (foldQuiet && records.length <= QUIET_MAX);
        if (!quiet) { blocks.push({ kind: 'decade', decade: d, records }); continue; }
        const prev = blocks[blocks.length - 1];
        if (prev?.kind === 'quiet') { prev.to = d; prev.records.push(...records); }
        else blocks.push({ kind: 'quiet', from: d, to: d, records: [...records] });
    }
    return blocks;
}

/** One person's lane in Who was here when: their spans and markers, by first record here. */
export interface Lane {
    personId: number;
    name: string;
    /** Each stay, first to last dated record; emigrating ends one and a later record starts the next. */
    spans: { from: number; to: number }[];
    marks: PlaceRecord[];
    undated: boolean;
}

export function lanes(records: readonly PlaceRecord[]): Lane[] {
    const byPerson = new Map<number, Lane>();
    for (const r of records) {
        for (const p of r.people) {
            let lane = byPerson.get(p.id);
            if (!lane) { lane = { personId: p.id, name: p.name, spans: [], marks: [], undated: true }; byPerson.set(p.id, lane); }
            lane.marks.push(r);
        }
    }
    for (const lane of byPerson.values()) {
        const dated = lane.marks.filter((m) => m.year != null).sort((a, b) => a.year! - b.year!);
        lane.undated = dated.length === 0;
        let open: { from: number; to: number } | null = null;
        for (const m of dated) {
            if (!open) { open = { from: m.year!, to: m.year! }; lane.spans.push(open); }
            else open.to = m.year!;
            if (m.type === 'EMIG') open = null;
        }
    }
    const first = (l: Lane) => l.spans[0]?.from ?? Infinity;
    return [...byPerson.values()].sort((a, b) => first(a) - first(b) || a.name.localeCompare(b.name));
}

/** A stretch of the lanes' axis: drawn to scale, or a long quiet stretch folded narrow. */
export interface AxisPart {
    from: number;
    to: number;
    folded: boolean;
}

/** Years with no record for longer than this fold into a narrow dotted strip. */
const QUIET_GAP = 40;

export function axisParts(years: readonly number[], unfold: boolean): AxisPart[] {
    const sorted = [...new Set(years)].sort((a, b) => a - b);
    if (sorted.length === 0) return [];
    const parts: AxisPart[] = [];
    let start = sorted[0]!;
    let prev = start;
    for (const y of sorted.slice(1)) {
        if (!unfold && y - prev > QUIET_GAP) {
            parts.push({ from: start, to: prev, folded: false }, { from: prev, to: y, folded: true });
            start = y;
        }
        prev = y;
    }
    parts.push({ from: start, to: prev, folded: false });
    return parts;
}

/** Width of a folded strip, in the same units as one year drawn to scale. */
const FOLD_UNITS = 6;
/** Breathing room either side of a to-scale stretch, in years. */
const PAD = 2;

/** Maps a year to a fraction (0–1) of the lane's width. */
export function axisScale(parts: readonly AxisPart[]): (year: number) => number {
    const widths = parts.map((p) => (p.folded ? FOLD_UNITS : p.to - p.from + PAD * 2));
    const total = widths.reduce((a, b) => a + b, 0) || 1;
    return (year: number) => {
        let offset = 0;
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i]!;
            if (!p.folded && year >= p.from - PAD && year <= p.to + PAD) return (offset + (year - p.from + PAD)) / total;
            if (p.folded && year > p.from && year < p.to) return (offset + FOLD_UNITS / 2) / total;
            offset += widths[i]!;
        }
        return Math.min(1, Math.max(0, offset / total));
    };
}
