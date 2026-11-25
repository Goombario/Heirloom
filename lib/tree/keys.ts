/**
 * Structured node identity for the tree canvas.
 *
 * React Flow needs string node IDs, and focus mode additionally needs a
 * "canonical" identity for deduplicating the same person across its three
 * subtrees. Those strings used to be built with inline template literals and
 * parsed back with regexes scattered across the layout code — a stringly-typed
 * cross-file protocol. This module is the single codec for that protocol:
 *
 *   person-42                 main card
 *   person-42-spouse1-of7     42 rendered as the 2nd spouse of person 7's card
 *   person-42-again1          42's 2nd card in one layout (a faded repeat, #13);
 *                             also on a spouse card: person-42-spouse0-of9-again1
 *   person-42-sibling         42 rendered as an injected root-sibling (ancestors mode)
 *   left-person-42[...]       focus-mode cluster prefix, pre-dedup
 *                             (left | right | center)
 *
 * Canonical identity (dedup): cluster prefix and spouse suffix stripped —
 * `center-person-42-spouse0-of7` and `right-person-42` are the same person and
 * dedup to `person-42`. A repeat card (`-again<n>`) is its own canonical id,
 * cluster and all: it is drawn on purpose where the person is reached again, so
 * dedup never folds it into the full card (#13). The sibling suffix is preserved: sibling cards exist
 * only in ancestors mode, which never dedups, and the same person can appear
 * as both a spouse card and a sibling card there.
 */

type NodeRole = 'person' | 'spouse' | 'sibling';
export type FocusCluster = 'left' | 'right' | 'center';

export interface NodeKey {
  personId: number;
  role: NodeRole;
  /** Which spouse slot (0-based); only meaningful for role 'spouse'. */
  spouseIndex?: number;
  /** The person whose card this spouse card stands beside (role 'spouse'). Two
   *  partners who both have this spouse in slot 0 no longer share an id (#13). */
  ofPartner?: number;
  /** The nth later card for a person already drawn in this layout (1-based). */
  again?: number;
  /** Focus-mode subtree, pre-dedup only. */
  cluster?: FocusCluster;
}

/** The `left-` / `right-` / `center-` string prefix for a cluster ('' for none).
 *  Exposed for the edge-ID templates, which embed the same prefix. */
export function clusterPrefix(cluster?: FocusCluster): string {
  return cluster ? `${cluster}-` : '';
}

/** Encode a NodeKey to its React Flow node ID. */
export function nodeKeyToId(key: NodeKey): string {
  const suffix =
    key.role === 'spouse' ? `-spouse${key.spouseIndex ?? 0}${key.ofPartner !== undefined ? `-of${key.ofPartner}` : ''}`
    : key.role === 'sibling' ? '-sibling'
    : '';
  const again = key.again ? `-again${key.again}` : '';
  return `${clusterPrefix(key.cluster)}person-${key.personId}${suffix}${again}`;
}

const NODE_ID_RE = /^(?:(left|right|center)-)?person-(\d+)(?:-spouse(\d+)(?:-of(\d+))?|-(sibling))?(?:-again(\d+))?$/;

/** Decode a React Flow node ID; null if it isn't a tree-node ID. */
export function parseNodeId(id: string): NodeKey | null {
  const m = NODE_ID_RE.exec(id);
  if (!m) return null;
  const [, cluster, personId, spouseIndex, ofPartner, sibling, again] = m;
  return {
    personId: Number(personId),
    role: spouseIndex !== undefined ? 'spouse' : sibling ? 'sibling' : 'person',
    ...(spouseIndex !== undefined ? { spouseIndex: Number(spouseIndex) } : {}),
    ...(ofPartner !== undefined ? { ofPartner: Number(ofPartner) } : {}),
    ...(again !== undefined ? { again: Number(again) } : {}),
    ...(cluster ? { cluster: cluster as FocusCluster } : {}),
  };
}

/**
 * Dedup identity: strip the cluster prefix and any spouse suffix, keeping the
 * sibling suffix. A repeat card keeps its whole id. Unparseable IDs pass through
 * unchanged.
 */
export function canonicalNodeId(id: string): string {
  const key = parseNodeId(id);
  if (!key || key.again) return id;
  return nodeKeyToId({
    personId: key.personId,
    role: key.role === 'sibling' ? 'sibling' : 'person',
  });
}
