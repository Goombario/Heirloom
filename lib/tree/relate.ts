/**
 * "How are these two related?" on the tree (#256). Pure rules, so the Shift-click
 * choreography and the path drawing are tested without a canvas.
 *
 * Shift-click rules (recorded on #256):
 *  - The person open in the side panel is person 1, so one Shift-click is enough.
 *    The tree's start person never counts by itself.
 *  - Shift-clicking person 2 again takes them off; a third person replaces person 2
 *    and keeps person 1.
 *  - A plain click, Esc, or the empty tree clears it (a plain click then opens the
 *    panel as usual, so that person becomes the next person 1).
 */
import type { FlowEdge, FlowNode } from '@/app/components/tree/types';

export interface RelatePair { first: number | null; second: number | null }

export const NO_PAIR: RelatePair = { first: null, second: null };

/** The pair after Shift-clicking `clicked`, with `panelId` open in the side panel. */
export function shiftPick(pair: RelatePair, clicked: number, panelId: number | null): RelatePair {
    const first = pair.first ?? (panelId != null && panelId !== clicked ? panelId : null);
    if (first == null) return { first: clicked, second: null };
    if (clicked === first) return { first, second: pair.second };
    if (clicked === pair.second) return { first, second: null };
    return { first, second: clicked };
}

/** `relate=12,34` from the tree's URL (the Relationship tool's "Show in the tree"). */
export function parseRelateParam(value: string | null): RelatePair {
    const m = value?.match(/^(\d+),(\d+)$/);
    if (!m) return NO_PAIR;
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a > 0 && b > 0 && a !== b ? { first: a, second: b } : NO_PAIR;
}

/** How a card takes part: one of the two people, on the path between, or faded. */
export type RelateRole = 'first' | 'second' | 'on' | 'dim';

/** The people a card stands for; a line between two cards joins any of them. */
function peopleOf(n: FlowNode): number[] {
    // A join stands for the person and the partner of its marriage.
    if (n.data.joinOf) return [...n.data.joinOf];
    const ids = [n.data.person.id];
    if (n.data.partner) ids.push(n.data.partner.id);
    // A partner card's lines to children come from the couple, so they count for both.
    if (n.data.isSpouse && n.data.parentPersonId != null) ids.push(n.data.parentPersonId);
    return ids;
}

/**
 * Which cards and lines a path lights up. `path` is the person ids from person 1 to
 * person 2 (empty while only person 1 is picked). Cards not on the path fade only
 * once there is a path.
 */
export function relateRoles(
    nodes: FlowNode[],
    edges: FlowEdge[],
    pair: RelatePair,
    path: number[],
): { node: Map<string, RelateRole>; partner: Map<string, RelateRole>; edge: Map<string, 'on' | 'dim'> } {
    const node = new Map<string, RelateRole>();
    const partner = new Map<string, RelateRole>();
    const edge = new Map<string, 'on' | 'dim'>();
    if (pair.first == null) return { node, partner, edge };
    const onPath = new Set(path);
    const hasPath = path.length > 1;
    const role = (id: number): RelateRole | null =>
        id === pair.first ? 'first' : id === pair.second ? 'second' : onPath.has(id) ? 'on' : hasPath ? 'dim' : null;
    // A repeat card points at the full card, which carries the role.
    for (const n of nodes) {
        if (n.type === 'pedigreeGap' || n.type === 'pedigreeGapBar' || n.type === 'partnerJoin' || n.data.repeatOf) {
            if (hasPath && n.type !== 'partnerJoin') node.set(n.id, 'dim');
            continue;
        }
        const r = role(n.data.person.id);
        const pr = n.data.partner ? role(n.data.partner.id) : null;
        // A couple card fades only when neither half is on the path.
        const own = r === 'dim' && pr != null && pr !== 'dim' ? null : r;
        if (own) node.set(n.id, own);
        if (pr && pr !== 'dim') partner.set(n.id, pr);
    }
    if (!hasPath) return { node, partner, edge };

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const steps = new Set<string>();
    for (let i = 1; i < path.length; i++) {
        steps.add(`${path[i - 1]}>${path[i]}`);
        steps.add(`${path[i]}>${path[i - 1]}`);
    }
    for (const e of edges) {
        const s = byId.get(e.source);
        const t = byId.get(e.target);
        if (!s || !t) continue;
        const a = peopleOf(s);
        const b = peopleOf(t);
        const on = a.some((x) => b.some((y) => steps.has(`${x}>${y}`)));
        edge.set(e.id, on ? 'on' : 'dim');
    }
    return { node, partner, edge };
}

/** Every person drawn from a tree payload: cards, partners and ancestor-mode siblings. */
export function drawnPeople(...roots: unknown[]): Set<number> {
    const ids = new Set<number>();
    const walk = (v: unknown): void => {
        if (!v || typeof v !== 'object') return;
        const n = v as { id?: unknown; children?: unknown[]; spouses?: unknown[]; siblings?: unknown[] };
        if (typeof n.id === 'number') ids.add(n.id);
        for (const list of [n.children, n.spouses, n.siblings]) if (Array.isArray(list)) list.forEach(walk);
    };
    for (const r of roots) {
        if (r && typeof r === 'object' && !('id' in r)) Object.values(r).forEach(walk);
        else walk(r);
    }
    return ids;
}

/** One step of the Relationship tool's path: `relationship` is how this person
 *  relates to the one before ("child" = the one before is their child). */
interface PathStep { id: number; relationship: string }

/** The shared ancestor on a blood path: where it stops going up and turns down. */
export function sharedAncestor(path: readonly PathStep[]): number | null {
    const i = path.findIndex((s, k) => k > 0 && k < path.length - 1 && s.relationship === 'child' && path[k + 1].relationship === 'parent');
    return i < 0 ? null : path[i].id;
}

/**
 * Who to start a Descendants view from so the whole path is drawn: the shared
 * ancestor, else the elder end of a straight line, else person 1.
 */
export function wholePathRoot(path: readonly PathStep[]): number | null {
    if (path.length === 0) return null;
    const peak = sharedAncestor(path);
    if (peak != null) return peak;
    const steps = path.slice(1).map((s) => s.relationship);
    if (steps.length > 0 && steps.every((r) => r === 'child')) return path[path.length - 1].id;
    return path[0].id;
}
