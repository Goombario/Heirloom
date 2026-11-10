import { hierarchy, tree as d3tree } from 'd3-hierarchy';

const CARD = 96, GAP = 20, SIB_GAP = 60;
const root = {
  id: 'Wendy', width: CARD + GAP + CARD,
  children: [
    { id: 'Simon', width: CARD + GAP + CARD }, // 212 — leftmost in d3
    { id: 'Mark',  width: CARD },              // 96
    { id: 'Claire',width: CARD },              // 96
  ],
};

for (const mirrorX of [true, false]) {
  for (const formula of ['max', 'fix'] as const) {
    const calls: string[] = [];
    const hier = hierarchy(root, (d: typeof root) => d.children);
    d3tree<typeof root>()
      .nodeSize([1, 220])
      .separation((a, b) => {
        const aW = a.data.width, bW = b.data.width;
        let sep: number;
        if (formula === 'max') sep = Math.max(aW, bW) + SIB_GAP;
        else sep = (mirrorX ? aW : bW) + SIB_GAP;  // d3 calls (right, left): mirrored→aW, normal→bW
        calls.push(`  sep(${a.data.id}[${aW}], ${b.data.id}[${bW}]) = ${sep}`);
        return sep;
      })(hier);

    console.log(`\n[mirrorX=${mirrorX}  formula=${formula}]`);
    calls.forEach(c => console.log(c));
    hier.each(n => {
      const d3X = n.x ?? 0;
      const mainLeft = mirrorX ? -(d3X - 48 + 96) : d3X - 48;
      console.log(`  ${n.data.id.padEnd(8)} d3X=${String(d3X.toFixed(1)).padStart(7)}  canvasLeft=${mainLeft.toFixed(0)}`);
    });
  }
}
