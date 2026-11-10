import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the design-system color tokens against WCAG 2.1 AA contrast regressions.
 *
 * This is the fast, in-pipeline half of the contrast guard: it parses the real
 * hex tokens out of globals.css and asserts the ratios for the foreground/background
 * pairings the app actually renders, in BOTH themes. The browser-level half
 * (scripts/a11y-contrast-scan.mjs, run by `npm run test:a11y`) renders the pages and
 * runs axe-core; this test catches a bad token edit without needing a browser.
 *
 * If you intentionally retune a token, update the expected pairing here too.
 */

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

// --- WCAG relative luminance + contrast ratio ---------------------------------
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = ch.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Composite `fg` over `bg` at `alpha` and return the resulting solid hex.
 *
 * Tailwind's `text-<token>/NN` opacity modifier renders as a SEMI-TRANSPARENT
 * foreground, so the colour the user actually sees — and the one axe measures —
 * is this blend, not the token itself. Contrast must be asserted against the
 * composite. Without this, an alpha low enough to fail AA is invisible to a
 * token-vs-token test: exactly how the active FilterChip count badge shipped at
 * `text-card/55` (3.51:1 in dark theme) unnoticed.
 */
function over(fg: string, bg: string, alpha: number): string {
  const px = (h: string) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
  const [f, b] = [px(fg), px(bg)];
  return `#${[0, 1, 2]
    .map((i) => Math.round(alpha * f[i] + (1 - alpha) * b[i]).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

// --- Parse the light (@theme/:root) and dark (html.dark) token blocks ---------
function parseTokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--color-[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    out[m[1]] = m[2].toUpperCase();
  }
  return out;
}
const darkStart = CSS.indexOf('html.dark {');
const lightCss = CSS.slice(0, darkStart);
const darkBlock = CSS.slice(darkStart, CSS.indexOf('}', darkStart));

const light = parseTokens(lightCss);
const dark = { ...light, ...parseTokens(darkBlock) }; // dark overrides cascade onto light

const AA = 4.5; // normal text

// fg token, bg token, theme map, label
type Case = [string, string, Record<string, string>, string];
const cases: Case[] = [
  // Muted body/label text on the parchment surfaces (the audit's biggest offender).
  ['--color-text-muted', '--color-surface', light, 'light: muted text on surface'],
  ['--color-text-muted', '--color-surface-2', light, 'light: muted text on surface-2'],
  ['--color-text-muted', '--color-card', light, 'light: muted text on card'],
  ['--color-text-muted', '--color-surface', dark, 'dark: muted text on surface'],
  ['--color-text-muted', '--color-card', dark, 'dark: muted text on card'],
  // Muted dates (#935, ADR 0034) sit on rows that also take the selected and hover
  // fills: GlobalSearch's selected row is surface-2, list hovers are card-alt.
  ['--color-text-muted', '--color-surface-2', dark, 'dark: muted date on a selected row'],
  ['--color-text-muted', '--color-card-alt', light, 'light: muted date on a hovered row'],
  ['--color-text-muted', '--color-card-alt', dark, 'dark: muted date on a hovered row'],
  // Evidence amber (#688) as citation/evidence text on the parchment and on cards.
  ['--color-evidence', '--color-surface', light, 'light: evidence text on surface'],
  ['--color-evidence', '--color-card', light, 'light: evidence text on card'],
  ['--color-evidence', '--color-card', dark, 'dark: evidence text on card'],
  ['--color-evidence', '--color-surface', dark, 'dark: evidence text on surface'],
  // Citation chip: evidence text on the chip fill.
  ['--color-evidence', '--color-evidence-soft', light, 'light: citation chip text'],
  ['--color-evidence', '--color-evidence-soft', dark, 'dark: citation chip text'],
  // Complete-sourcing tag (Badge tone="evidence").
  ['--color-on-evidence-tag', '--color-evidence-tag', light, 'light: complete-sourcing tag text'],
  ['--color-on-evidence-tag', '--color-evidence-tag', dark, 'dark: complete-sourcing tag text'],
  // Amber date text (`.date-mono` lifespans/citations) on every light surface it
  // renders on — list rows (card #FFF), expanded people/family cards (surface-2),
  // and the page surface. #333: was #D97706 at 3.2:1 on white list rows (an AA
  // fail the empty-state browser scan never rendered); darkened to clear AA here.
  ['--color-date', '--color-card', light, 'light: date text on card'],
  ['--color-date', '--color-card-alt', light, 'light: date text on card-alt'],
  ['--color-date', '--color-surface', light, 'light: date text on surface'],
  ['--color-date', '--color-surface-2', light, 'light: date text on surface-2 (expanded cards)'],
  ['--color-date', '--color-card', dark, 'dark: date text on card'],
  ['--color-date', '--color-surface', dark, 'dark: date text on surface'],
  // Ink navigational links (#688) on the page surface and cards.
  ['--color-link', '--color-card', light, 'light: link on card'],
  ['--color-link', '--color-surface', light, 'light: link on surface'],
  ['--color-link', '--color-surface-2', light, 'light: link on surface-2'],
  ['--color-link', '--color-surface', dark, 'dark: link on surface'],
  ['--color-link', '--color-card', dark, 'dark: link on card'],
  // #719: dark links were 4.02:1 on card-alt.
  ['--color-link', '--color-card-alt', dark, 'dark: link on card-alt'],
  // Foreground placed ON a solid evidence fill.
  ['--color-on-evidence', '--color-evidence', light, 'light: on-evidence over evidence'],
  ['--color-on-evidence', '--color-evidence', dark, 'dark: on-evidence over evidence'],
  // Light ink for links/focus on the lightbox stage + sheet (dark in both themes).
  ['--color-ink-on-dark', '--color-lightbox-stage-top', light, 'lightbox: ink link on stage'],
  ['--color-ink-on-dark', '--color-lightbox-sheet', light, 'lightbox: ink link on mobile sheet'],
  // Status text on its own status background: error/success/warning/info banners,
  // toasts and pills all pair these two tokens (e.g. `bg-error-bg text-error`).
  // dark error was 3.62:1 (#F87171 on red-900) and shipped to Cloudflare/Tauri —
  // the browser scan missed it because it renders `next dev`, where the banner it
  // appeared in (a DB error on /audit) never rendered.
  ['--color-error', '--color-error-bg', light, 'light: error text on error bg'],
  ['--color-error', '--color-error-bg', dark, 'dark: error text on error bg'],
  ['--color-success', '--color-success-bg', light, 'light: success text on success bg'],
  ['--color-success', '--color-success-bg', dark, 'dark: success text on success bg'],
  ['--color-warning-text', '--color-warning-bg', light, 'light: warning text on warning bg'],
  ['--color-warning-text', '--color-warning-bg', dark, 'dark: warning text on warning bg'],
  // The Data checks "Check this date" mark (#833): warning text on a card-filled button.
  ['--color-warning-text', '--color-card', light, 'light: warning text on card'],
  ['--color-warning-text', '--color-card', dark, 'dark: warning text on card'],
  ['--color-info-text', '--color-info-bg', light, 'light: info text on info bg'],
  ['--color-info-text', '--color-info-bg', dark, 'dark: info text on info bg'],
  // Living-status mark (StatusMark, 2026-09-23; colours #736): the † glyph on the
  // deceased fill. The mark is decorative (its word or label carries meaning), but
  // the glyph is still held to AA so † reads at 14px. Living is a plain dot with no
  // glyph, so only the light pairing is held (dark living #34D399 takes no white).
  ['--color-on-status', '--color-status-living', light, 'light: status glyph on living'],
  ['--color-on-status', '--color-status-deceased', light, 'light: status glyph on deceased'],
  ['--color-on-status', '--color-status-deceased', dark, 'dark: status glyph on deceased'],
  ['--color-status-unknown', '--color-card', light, 'light: unknown status ring on card'],
  ['--color-status-unknown', '--color-card', dark, 'dark: unknown status ring on card'],
  // Announcement tag ("NEW", #692).
  ['--color-on-new', '--color-new-bg', light, 'light: NEW tag text'],
  ['--color-on-new', '--color-new-bg', dark, 'dark: NEW tag text'],
  // ui/AvatarStack's "+N" overflow disc — `--color-text-secondary` numerals on a
  // `--color-surface-2` fill, at roughly 11px, so it needs the normal-text bar.
  // The browser scan cannot see this either: the disc only renders when a cluster
  // overflows, which needs seeded people.
  ['--color-text-secondary', '--color-surface-2', light, 'light: avatar-stack +N disc'],
  ['--color-text-secondary', '--color-surface-2', dark, 'dark: avatar-stack +N disc'],
  // SegmentedControl / active FilterChip selection (#691, decision 5): the selected
  // segment is a `--color-text` fill on a transparent track over the card or page
  // surface, and its label is `--color-card` on that fill. The old `bg-card` on
  // `bg-card-alt` selection was 1.06:1 in dark. Held to AA, above the 3:1 needed
  // for a non-text indicator.
  ['--color-text', '--color-card', light, 'light: selected segment fill vs card track'],
  ['--color-text', '--color-surface', light, 'light: selected segment fill vs surface track'],
  ['--color-text', '--color-card', dark, 'dark: selected segment fill vs card track'],
  ['--color-text', '--color-surface', dark, 'dark: selected segment fill vs surface track'],
  ['--color-card', '--color-text', light, 'light: selected segment label'],
  ['--color-card', '--color-text', dark, 'dark: selected segment label'],
];

describe('design-system color tokens meet WCAG AA contrast', () => {
  it('parsed both theme token blocks', () => {
    expect(Object.keys(light).length).toBeGreaterThan(20);
    expect(dark['--color-nav-bg']).toBeDefined();
    expect(dark['--color-on-evidence']).toBeDefined();
    // The copper action fill is the same in both themes, so check a token that differs.
    expect(dark['--color-link']).not.toBe(light['--color-link']);
  });

  it.each(cases)('%s / %s — %s', (fg, bg, theme, _label) => {
    expect(theme[fg], `${fg} missing`).toBeDefined();
    expect(theme[bg], `${bg} missing`).toBeDefined();
    expect(ratio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(AA);
  });

  // White text sits on these backgrounds (nav bar, danger button) in both themes.
  // The lightbox is a dark island in BOTH themes, so its white panel/stage text is
  // guarded once against the theme-neutral --color-lightbox-* surfaces (stage-top is
  // the lightest dark → the worst case for white legibility on the stage).
  // An ACTIVE FilterChip inverts to `bg-text text-card`, and its count badge is
  // `text-card/70` — --color-card composited over --color-text. Dark theme is the
  // tight side (near-white chip, dark count). At the original 55% this composited to
  // #878584 = 3.51:1, a real AA failure on 12px text that neither guard could see:
  // this test only compared solid token pairs, and the browser scan renders /families
  // in its EMPTY state, where no count badge exists to measure.
  const CHIP_COUNT_ALPHA = 0.7;
  it.each([
    ['light: active chip count over the inverted chip', light],
    ['dark: active chip count over the inverted chip', dark],
  ] as [string, Record<string, string>][])('active FilterChip count — %s', (_label, theme) => {
    const chipBg = theme['--color-text'];
    const composited = over(theme['--color-card'], chipBg, CHIP_COUNT_ALPHA);
    expect(ratio(composited, chipBg)).toBeGreaterThanOrEqual(AA);
  });

  it.each([
    ['--color-nav-bg', light, 'light: white nav text on nav bar'],
    ['--color-nav-bg', dark, 'dark: white nav text on nav bar'],
    // Ink main-action fill (#688): white label on the primary Button, rest and (light) hover.
    ['--color-primary', light, 'light: white text on primary action'],
    ['--color-primary-dark', light, 'light: white text on primary action hover'],
    ['--color-primary', dark, 'dark: white text on primary action'],
    // #719: the dark hover was #4A7AD2 at 4.20:1.
    ['--color-primary-dark', dark, 'dark: white text on primary action hover'],
    ['--color-button-danger', light, 'light: white text on danger button'],
    ['--color-button-danger', dark, 'dark: white text on danger button'],
    ['--color-lightbox-panel', light, 'lightbox: white text on panel'],
    ['--color-lightbox-stage-top', light, 'lightbox: white text on stage (lightest)'],
  ] as [string, Record<string, string>, string][])('white on %s — %s', (bg, theme) => {
    expect(theme[bg], `${bg} missing`).toBeDefined();
    expect(ratio('#FFFFFF', theme[bg])).toBeGreaterThanOrEqual(AA);
  });

  // Focus ring (#688): a non-text indicator, so WCAG 1.4.11's 3:1 against the surfaces
  // it sits on. The dark --color-primary (#A9531F) is only 2.9:1 on a card, which is
  // why the ring has its own lighter token.
  it.each([
    ['--color-card', light, 'light: focus ring on card'],
    ['--color-surface', light, 'light: focus ring on surface'],
    ['--color-card', dark, 'dark: focus ring on card'],
    ['--color-surface', dark, 'dark: focus ring on surface'],
  ] as [string, Record<string, string>, string][])('focus ring vs %s — %s', (bg, theme) => {
    expect(ratio(theme['--color-focus'], theme[bg])).toBeGreaterThanOrEqual(3);
  });

  // Hero dates (#688): the dark island overrides --color-date to one amber in BOTH
  // themes. The .hero-dark gradient runs from --color-hero-bg mixed with
  // --color-hero-tint (top-left, lightest: slate blue in light, copper in dark; #1246)
  // to --color-hero-bg mixed with black. Dates sit below
  // the name, well away from the top-left corner, so this asserts the gradient's
  // midpoint and its dark end. KNOWN GAP: at the very top-left stop of the DARK theme
  // (#5D4837) #E9A94F is 4.19:1 — fine where dates render, but not everywhere.
  const islandStart = CSS.indexOf('.dark-island,');
  const island = parseTokens(CSS.slice(islandStart, CSS.indexOf('}', islandStart)));
  it.each([
    ['light', light],
    ['dark', dark],
  ] as [string, Record<string, string>][])('hero date on the hero gradient — %s theme', (_label, theme) => {
    const heroDate = island['--color-date'];
    expect(heroDate, 'hero --color-date missing').toBeDefined();
    const lightest = over(theme['--color-hero-bg'], theme['--color-hero-tint'], 0.7);
    const darkest = over(theme['--color-hero-bg'], '#000000', 0.9);
    const midpoint = over(lightest, darkest, 0.5);
    expect(ratio(heroDate, midpoint)).toBeGreaterThanOrEqual(AA);
    expect(ratio(heroDate, darkest)).toBeGreaterThanOrEqual(AA);
  });

  // Light mode's hero is ink navy (#1246); dark mode keeps the warm umber and copper
  // corner exactly as before. Every island text colour clears AA on both light stops.
  it('hero: ink navy in light, umber unchanged in dark', () => {
    expect(light['--color-hero-bg']).toBe('#1F2B3D');
    expect(light['--color-hero-tint']).toBe('#3E5677');
    expect(dark['--color-hero-bg']).toBe('#4A3D38');
    expect(dark['--color-hero-tint']).toBe('#8A6034');
  });
  it('hero: island text clears AA on both light-mode stops', () => {
    const lightest = over(light['--color-hero-bg'], light['--color-hero-tint'], 0.7);
    const darkest = over(light['--color-hero-bg'], '#000000', 0.9);
    for (const stop of [lightest, darkest]) {
      for (const fg of [
        '#FFFFFF',
        over('#FFFFFF', stop, 0.82),
        over('#FFFFFF', stop, 0.66),
        island['--color-date'],
        island['--color-link'],
        island['--color-warning-text'],
        island['--color-error'],
      ]) {
        expect(ratio(fg, stop), `${fg} on ${stop}`).toBeGreaterThanOrEqual(AA);
      }
      expect(ratio(over('#FFFFFF', stop, 0.55), stop)).toBeGreaterThanOrEqual(3);
    }
  });

  // The phone slim bar (#1099) is solid slate in light mode; its years and tree name
  // keep the island's hero amber, and its name and icons are white. Dark mode shows
  // the hero gradient behind it, covered by the test above.
  it('slim bar: hero amber and white on the light slate', () => {
    expect(light['--color-slim-bar'], '--color-slim-bar missing').toBeDefined();
    expect(ratio(island['--color-date'], light['--color-slim-bar'])).toBeGreaterThanOrEqual(AA);
    expect(ratio('#FFFFFF', light['--color-slim-bar'])).toBeGreaterThanOrEqual(AA);
  });

  // The home band and list headers take the same slate; the band's counts and eyebrow
  // are the island's muted white.
  it('slim bar: island muted text on the light slate', () => {
    // The island's --color-text-muted is rgba(255,255,255,0.66).
    expect(ratio(over('#FFFFFF', light['--color-slim-bar'], 0.66), light['--color-slim-bar'])).toBeGreaterThanOrEqual(AA);
  });

  // Living and deceased once differed by hue alone (1.13:1 light, 1.31:1 dark). #736
  // holds them apart by lightness too, so the marks read without colour vision.
  it('status: living and deceased differ by more than hue', () => {
    expect(ratio(light['--color-status-living'], light['--color-status-deceased'])).toBeGreaterThanOrEqual(3);
    // 2.5:1 when rounded (2.496).
    expect(ratio(dark['--color-status-living'], dark['--color-status-deceased'])).toBeGreaterThanOrEqual(2.49);
  });

  // The tree card's age (#736 B7) is white 11px bold on a fade that rises to
  // rgba(28,25,23,.7) at the photo's foot. Worst case is a white photo behind it.
  it('tree card: age on the photo fade over a white photo', () => {
    expect(ratio('#FFFFFF', over('#1C1917', '#FFFFFF', 0.7))).toBeGreaterThanOrEqual(AA);
  });

  // The family hero's "dates to check" flag (#833): the island's dark warning pair
  // in BOTH themes, then the ink "Review ›" link on the hero gradient.
  it('hero flag: warning text on its fill', () => {
    expect(island['--color-warning-text'], 'island --color-warning-text missing').toBeDefined();
    expect(ratio(island['--color-warning-text'], island['--color-warning-bg'])).toBeGreaterThanOrEqual(AA);
  });
  it.each([
    ['light', light],
    ['dark', dark],
  ] as [string, Record<string, string>][])('hero flag: Review link on the hero gradient — %s theme', (_label, theme) => {
    const link = island['--color-link'];
    expect(link).toBe('#C3CEDC');
    const lightest = over(theme['--color-hero-bg'], theme['--color-hero-tint'], 0.7);
    const darkest = over(theme['--color-hero-bg'], '#000000', 0.9);
    expect(ratio(link, over(lightest, darkest, 0.5))).toBeGreaterThanOrEqual(AA);
    expect(ratio(link, darkest)).toBeGreaterThanOrEqual(AA);
  });
});

// Tag text (audit §13 addendum, 2026-09-23): tags are quiet fills with no edge, so the
// 2:1 shape rule of #692 is retired. The fills are faint against their surface by
// design; what must hold is that every tag's TEXT is AA on its own fill, in both themes.
describe('tag text meets AA on its own fill', () => {
  const tones: Array<[string, string, string]> = [
    ['neutral / NEW (quiet fill)', '--color-new-bg', '--color-on-new'],
    ['evidence', '--color-evidence-tag', '--color-on-evidence-tag'],
    ['warning', '--color-warning-bg', '--color-warning-text'],
    ['green', '--color-success-bg', '--color-success'],
    ['blue', '--color-info-bg', '--color-info-text'],
    ['red', '--color-error-bg', '--color-error'],
    ['violet', '--color-count-bg', '--color-count-text'],
  ];
  const rows = tones.flatMap(([tone, fill, text]) =>
    (['light', 'dark'] as const).map((name) => [tone, name, fill, text] as const));
  it.each(rows)('%s (%s)', (_tone, name, fill, text) => {
    const theme = name === 'light' ? light : dark;
    expect(ratio(theme[text], theme[fill])).toBeGreaterThanOrEqual(4.5);
  });
});

// Add media's drop strip (#1204): its dashed edge is the only outline of a drop
// target, so it holds the 3:1 non-text floor on its own fill and on the card around it.
describe('the drop-strip edge stands out', () => {
  const rows = (['light', 'dark'] as const).flatMap((name) => ['--color-card', '--color-card-alt'].map((s) => [name, s] as const));
  it.each(rows)('%s: drop-edge on %s >= 3:1', (name, surface) => {
    const theme = name === 'light' ? light : dark;
    expect(theme['--color-drop-edge'], 'drop-edge missing').toBeDefined();
    expect(ratio(theme['--color-drop-edge'], theme[surface])).toBeGreaterThanOrEqual(3);
  });
});

// Warning fills that must be SEEN, not just back text (#899, #824). The warning-bg
// fill is ~1.03:1 on a dark card, so a warning's shape comes from warning-edge: the
// badge's 1px ring, the "Check this date" mark's border and the flagged row's 3px
// edge. The flagged row's tint stays deliberately faint; its edge carries it.
describe('warning edges stand out from their surfaces', () => {
  const surfaces = ['--color-card', '--color-card-alt', '--color-surface-2', '--color-surface'];
  const rows = (['light', 'dark'] as const).flatMap((name) => surfaces.map((s) => [name, s] as const));
  it.each(rows)('%s: warning-edge on %s >= 3:1', (name, surface) => {
    const theme = name === 'light' ? light : dark;
    expect(theme['--color-warning-edge'], 'warning-edge missing').toBeDefined();
    expect(ratio(theme['--color-warning-edge'], theme[surface])).toBeGreaterThanOrEqual(3);
  });
  it.each([['light', light], ['dark', dark]] as [string, Record<string, string>][])(
    'the edge is visible against the warning fill it frames (%s)', (_name, theme) => {
      expect(ratio(theme['--color-warning-edge'], theme['--color-warning-bg'])).toBeGreaterThanOrEqual(3);
    });
  // The overdue-backup dot is the only sign below xl (WCAG 1.4.11): it sits on the
  // nav chip, white/10 over the nav bar, which is dark in both themes.
  it.each([['light', light], ['dark', dark]] as [string, Record<string, string>][])(
    'overdue-backup dot on the nav chip >= 3:1 (%s)', (_name, theme) => {
      const chip = over('#FFFFFF', theme['--color-nav-bg'], 0.1);
      expect(ratio(light['--color-nav-warning'], chip)).toBeGreaterThanOrEqual(3);
    });
});

// SegmentedControl's selected segment (#691) on a dark island. The default fill is
// text-on-card, which the island turns into near-white on white (~1.1:1), so the
// island pins its own solid pair.
describe('selected segment on a dark island', () => {
  const islandStart = CSS.indexOf('.dark-island,');
  const island = parseTokens(CSS.slice(islandStart, CSS.indexOf('}', islandStart)));
  it('text on fill meets AA', () => {
    const bg = island['--color-segment-on'];
    const fg = island['--color-on-segment'];
    expect(bg, 'island --color-segment-on missing').toBeDefined();
    expect(fg, 'island --color-on-segment missing').toBeDefined();
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
