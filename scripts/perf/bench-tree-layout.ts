/**
 * Tree layout compute bench — isolates the pure d3-hierarchy position math
 * (`getLayoutMode(mode).compute(...)`) from React Flow rendering.
 *
 * The audit's tree concern is "is the tree slow because of layout math or
 * because of rendering N cards?". This bench answers the first half with no
 * browser involved: it fetches the real TreeData the server builds for the
 * large tree, then times the exact pure function the React adapter calls.
 * Whatever this costs is CPU the main thread pays before React Flow draws a
 * single node.
 *
 * Run via tsx (it imports the real TS layout modules + d3-hierarchy):
 *   npx tsx scripts/perf/bench-tree-layout.ts
 */
import { getLayoutMode } from '@/lib/tree/layout/registry';
import type { TreeData } from '@/app/components/tree/types';
import { BASE_URL, TREE_MODES, THRESHOLDS } from './config.mjs';
import { summarize, writeResult, runMeta, padCols } from './lib/stats.mjs';

type LayoutRow = {
  mode: string;
  error?: string;
  nodes?: number;
  ms?: { p50?: number; p95?: number; max?: number; mean?: number };
  flags?: string[];
};

const ITER = Number(process.env.PERF_LAYOUT_ITER ?? 50);

async function fetchTree(mode: string): Promise<TreeData> {
  const res = await fetch(`${BASE_URL}/api/tree?mode=${mode}`);
  if (!res.ok) throw new Error(`/api/tree?mode=${mode} -> HTTP ${res.status}`);
  return (await res.json()) as TreeData;
}

/** Count nodes in a hierarchy so the report ties timing to tree size. */
function countNodes(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const children = (node as { children?: unknown[] }).children;
  if (!Array.isArray(children)) return 1;
  return 1 + children.reduce((sum: number, c: unknown) => sum + countNodes(c), 0);
}

export async function benchTreeLayout({ timestamp }: { timestamp?: string | null } = {}) {
  const results: unknown[] = [];

  for (const mode of TREE_MODES) {
    let data: TreeData;
    try {
      data = await fetchTree(mode);
    } catch (e) {
      results.push({ mode, error: (e as Error).message });
      continue;
    }

    const layout = getLayoutMode(mode);
    const input = { tree: data.tree, focusTrees: data.focusTrees };

    // warm the JIT
    for (let i = 0; i < 5; i++) layout.compute(input);

    const samples: number[] = [];
    let nodeCount = 0;
    for (let i = 0; i < ITER; i++) {
      const t0 = performance.now();
      const out = layout.compute(input);
      samples.push(performance.now() - t0);
      nodeCount = out.nodes?.length ?? countNodes(data.tree);
    }

    const stats = summarize(samples);
    const flags: string[] = [];
    if ((stats.p95 ?? 0) > THRESHOLDS.tree_layout_ms) {
      flags.push(`layout p95 ${stats.p95}ms > ${THRESHOLDS.tree_layout_ms}ms`);
    }
    results.push({ mode, nodes: nodeCount, ms: stats, flags });
  }

  return { kind: 'tree-layout', meta: runMeta({ baseUrl: BASE_URL, iterations: ITER }), timestamp, results };
}

function printTable(env: Awaited<ReturnType<typeof benchTreeLayout>>) {
  const w = [14, 8, 9, 9, 9, 9];
  console.log('\n=== Tree layout compute (pure d3, ms) ===');
  console.log(padCols(['mode', 'nodes', 'p50', 'p95', 'max', 'mean'], w));
  console.log('-'.repeat(70));
  for (const r of env.results as LayoutRow[]) {
    if (r.error) { console.log(padCols([r.mode, 'ERR: ' + r.error], w)); continue; }
    console.log(padCols([r.mode, r.nodes, r.ms?.p50, r.ms?.p95, r.ms?.max, r.ms?.mean], w));
    for (const f of r.flags ?? []) console.log('   ⚠ ' + f);
  }
}

// Wrapped in an async IIFE (not top-level await): tsx compiles this file to CJS,
// where top-level await is unsupported.
if (process.argv[1]?.endsWith('bench-tree-layout.ts')) {
  void (async () => {
    const env = await benchTreeLayout({ timestamp: process.env.PERF_TIMESTAMP ?? null });
    printTable(env);
    writeResult('scripts/perf/baseline/tree-layout.json', env);
    console.log('\nwrote scripts/perf/baseline/tree-layout.json');
  })();
}
