# UX audit tooling

Tools for task-based UX audits, first used for [`docs/ux-audit/2026-09-24-task-audit.md`](../../docs/ux-audit/2026-09-24-task-audit.md) (#782). They gather evidence, not verdicts: nothing here asserts or runs in CI. Turn confirmed findings into real tests (see §11 of that report).

All output goes under the gitignored `.playwright-screenshots/`. Don't commit generated trees, screenshots or browser profiles.

## `gen-large-gedcom.mjs`: a large, messy, invented tree

```bash
npm run fixture:large-gedcom                                      # → .playwright-screenshots/ux-audit/large-tree.ged
node scripts/ux-audit/gen-large-gedcom.mjs --people 10000 --seed 1 --out /tmp/big.ged
```

The output is deterministic for a given `--seed` and `--people`. The defaults (seed 782, target 4000) reproduce the 2026-09-24 audit tree byte for byte: 4,824 people, 964 families, 40 sources, 8,290 citations. Ten planted people and three families are appended after it, for 4,834 people and 967 families in all. The tree contains:
- Cyrillic, accented French and very long names and places;
- approximate dates;
- remarriages;
- 40 planted duplicates, each with a NOTE naming the person it copies;
- a few impossible life spans;
- one planted case for each unlikely data check, each with a `Planted data check` note. The random tree only has impossible problems, and only unlikely ones can be confirmed, so these are what let you test Confirm and its Data check audit entry:

  | Person | Rule |
  |---|---|
  | Tobias Sallow, 1702–1818 | Over 110 at death |
  | Hazel Quill, born 1893, marked living | Living and over 110 today |
  | Maren Hallow, mother at 58 | Mother over 55 at a child's birth |
  | Jasper Marsh, father at 11 | Parent under 12 at a child's birth |
  | Ivy Fennick, married at 11 | Under 12 when a partnership starts |

These are the cases the 120-person `synthetic.hlbak` fixture can't show: scale, accent folding, duplicate detection and consistency checks.

Import it through the app's Import page, into an empty tree, so the import flow is part of what you test.

## `harness.mjs`: one browser session per task script

```js
// .playwright-screenshots/ux-audit/cite-household.mjs (keep task scripts with their evidence)
import { session } from '../../scripts/ux-audit/harness.mjs';

const s = await session('cite-household', { width: 390, height: 844, treeId: 2 });
const { page } = s;
await s.go('/people/view?id=1788');
await s.step('open-pin', () => page.getByRole('button', { name: 'Attach source for birth' }).click());
s.note('focus after opening: ' + (await s.focus()));
await s.done(); // writes shots/cite-household/log.txt
```

Run task scripts from the repository root; `OUT_DIR` is resolved from the current directory.

What it gives you:
- **One persistent Chromium profile per viewport**, or per `PROFILE`. The active tree and other `localStorage` settings carry across scripts. Pass `treeId` to set the active tree up front. Delete `.playwright-screenshots/ux-audit/.profiles/` to start from a fresh browser.
- **`step(label, fn)`** runs one action and takes a numbered screenshot. A failure is logged, not thrown, so a long task still produces the rest of its evidence.
- **Each log line** has the elapsed time, the URL, and any page errors, console errors or failed `/api/` calls since the previous step.
- **`focus()` and `tab(n)`** report where keyboard focus lands. `BODY` means focus was lost.
- **Options:** `width`, `height`, `theme`, `language` (`en`/`fr`/`ru`), `treeId`, `profile`. Set the app URL with `BASE_URL`, and the evidence root with `OUT_DIR`.

## Environment

Run audits against a production build and a throwaway database, never your real data. The report's Appendix A has the full recipe. One trap: `npm run build:static` overwrites `.next`, so build the static flavour in a separate copy, or rebuild the hosted app before restarting it.
