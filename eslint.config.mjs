import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noInlineStaticLiteral from "./eslint-rules/no-inline-static-literal.mjs";
import noArbitraryFontSize from "./eslint-rules/no-arbitrary-font-size.mjs";

// Local design-system plugin (issue #175 — inline-style de-literalization;
// #687 — arbitrary font sizes).
const dsPlugin = {
  rules: {
    "no-inline-static-literal": noInlineStaticLiteral,
    "no-arbitrary-font-size": noArbitraryFontSize,
  },
};

const errorHandlingSelectors = [
  {
    selector: "CallExpression[callee.name='handleDataError']",
    message:
      "handleDataError is not allowed in app callers — use redirectIfUnauthorized or reportError so failures remain visible.",
  },
  {
    selector: "ImportSpecifier[imported.name='handleDataError']",
    message:
      "handleDataError is not allowed in app callers — use the named auth helper or useErrorToast.",
  },
];

// Structural-artifact selectors (issue #80 + migration sweep). Shared between the
// strict app block (error) and the deferred Cases block (warn) so they stay in sync.
const dsArtifactSelectors = [
  {
    // Scoped to className attributes and cx()/clsx()/cn() calls so the canonical
    // Badge/Button props (`shape="pill"`, `tone="amber"`, …) are NOT false-flagged
    // for containing a retiring class name as a substring. The badge-* group uses
    // (?<![\\w-])…(?![\\w-]) so the standalone bespoke classes (`badge-living`)
    // match but the token-named Tailwind utilities (`bg-badge-info-bg`,
    // `text-badge-warning-text`) do NOT.
    selector:
      ":matches(JSXAttribute[name.name='className'], CallExpression[callee.name=/^(cx|clsx|cn)$/]) Literal[value=/\\b(?:btn-primary|btn-secondary|btn-accent|btn-success|btn-danger|btn-outline|btn-ghost|section-card|card-interactive|page-empty|pill|input-field|input-field-sm|link-view)\\b|(?<![\\w-])(?:badge-(?:living|deceased|unknown|info|warning|count)|text-date|font-serif)(?![\\w-])/]",
    message:
      "Bespoke design-system class is being retired (issue #80) — use a @/app/components/ui primitive (Button, Card, Badge, …) instead.",
  },
  {
    selector:
      "MemberExpression[object.name='document'][property.name=/^(getElementById|querySelector|querySelectorAll)$/]",
    message:
      "Imperative DOM access (migration artifact) — use a React ref or state instead of document.* queries.",
  },
  {
    selector: "MemberExpression[property.name='innerHTML']",
    message:
      "innerHTML (migration artifact) — render via JSX, not direct innerHTML assignment.",
  },
  {
    selector:
      "Literal[value=/bg-card[^\"']*rounded-(xl|card)|rounded-(xl|card)[^\"']*bg-card/]",
    message:
      "Hand-rolled card markup — use the <Card> primitive from @/app/components/ui instead.",
  },
  ...errorHandlingSelectors,
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Honor the `_`-prefix convention for intentionally-unused args/vars
  // (e.g. interface-required params the implementation ignores).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  // Design-system guardrail — discourage NEW usage of the retiring bespoke
  // component classes (issue #80). Warn app-wide so the ~250 existing call
  // sites don't break CI; each is removed during its surface migration / the
  // final cleanup sweep. `input-field`/`input-field-sm`/`link-view`/`pill` were
  // fully retired in #331 (their CSS rules are gone) — they stay in the list so
  // a ghost usage can't sneak back in. (`input-nozoom`, the iOS auto-zoom
  // guard, is a behavioral hook, not a retiring style class.) `text-date` and
  // `font-serif` stay flagged so the canonical typography classes remain the one
  // blessed path (`.serif`/`.mono`/`.date-mono`). #342 fixed the fonts footgun —
  // moving the next/font vars to <html> means the @theme --font-serif/-mono
  // aliases now resolve at :root, so `font-serif`/`font-mono` DO render Fraunces/
  // JetBrains Mono. `font-serif` is kept out of new code for consistency with
  // `.serif`; `text-date` is a colour-only utility that still drops the mono +
  // weight of a proper date treatment, so dates must use `.date-mono`.
  // ERROR for non-`ui`, non-Cases app code: the retiring bespoke classes,
  // imperative DOM, innerHTML, and hand-rolled cards may not be reintroduced.
  // Cases was the last warn-scoped surface — its rebuild is complete, so the
  // exception is gone and the guardrail is now error app-wide (#80 complete).
  {
    files: ["app/**/*.{ts,tsx}"],
    ignores: ["app/components/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...dsArtifactSelectors],
    },
  },
  // Design-system cleanup (#175) — block NEW static, tokenizable literals inside
  // inline `style={{}}` objects (raw hex/rgba colors, raw px/em lengths, bare
  // numeric spacing/size/weight). Computed/dynamic values (positions, canvas
  // coords, calc(env(...)), prop-derived) are allowed by the rule itself, so
  // tree/map canvas styles don't trip it. Applies app-wide INCLUDING ui/** (the
  // strictest layer). The ~1,725 pre-existing violations (82 files) are captured
  // in `eslint-suppressions.json` (a baseline-and-shrink ratchet) — run
  // `npx eslint --prune-suppressions` after de-literalizing a surface.
  {
    files: ["app/**/*.{ts,tsx}"],
    plugins: { ds: dsPlugin },
    rules: { "ds/no-inline-static-literal": "error" },
  },
  // Type ramp (#687) — block NEW arbitrary `text-[Npx]` font sizes anywhere under
  // app/, including ui/**. Pre-existing uses are baselined in
  // `eslint-suppressions.json`; run `npx eslint --prune-suppressions` after
  // moving a surface onto the ramp.
  {
    files: ["app/**/*.{ts,tsx}"],
    plugins: { ds: dsPlugin },
    rules: { "ds/no-arbitrary-font-size": "error" },
  },
  // Design-system adherence — strict inside the canonical primitives layer.
  {
    files: ["app/components/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...errorHandlingSelectors,
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
          message: "Raw hex color — use a design-system token via a CSS class or var().",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]",
          message: "Raw hex color in template — use a design-system token.",
        },
        {
          selector: "Literal[value=/font-family/i]",
          message: "Set fonts via tokens (--font-sans/-serif/-mono), not literal font-family.",
        },
        {
          selector:
            "MemberExpression[object.name='document'][property.name=/^(getElementById|querySelector|querySelectorAll)$/]",
          message:
            "Imperative DOM access is not allowed in canonical primitives — use refs/state.",
        },
        {
          selector: "MemberExpression[property.name='innerHTML']",
          message: "innerHTML is not allowed in canonical primitives — render via JSX.",
        },
      ],
    },
  },
  // Client error surfacing (tracker §15) — ban the `if (handleDataError(e)) return;`
  // swallow idiom in NEW app code. `handleDataError` only recognises 401 (it
  // redirects to sign-in) and returns false for everything else, so every other
  // failure — offline, 403, 409, 507, a 500 — disappeared silently. Mutations now
  // go through `const { reportError } = useErrorToast()`, which shows a translated
  // toast.
  //
  // `no-restricted-imports` blocks both alias and relative imports. The matching
  // call selector is composed into both app `no-restricted-syntax` blocks above,
  // so flat-config ordering cannot reopen the ui/** layer.
  {
    files: ["app/**/*.ts", "app/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // `patterns`, not `paths`: `paths` matches the specifier literally, so the
          // `@/lib/utils/data-error` form alone left a relative-path bypass
          // (`../lib/utils/data-error` did not error). The pattern covers both forms;
          // `importNamePattern` keeps the module's other exports (`isRecordGone`,
          // `errorToastKey`) importable.
          patterns: [
            {
              group: ["**/lib/utils/data-error"],
              importNamePattern: "^handleDataError$",
              message:
                "Use `const { reportError } = useErrorToast()` instead. handleDataError only " +
                "handles 401 and swallows everything else — tracker §15.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Tauri desktop shell — Rust crate + generated codegen assets (some are
    // binary files with a .ts extension under target/). Never lint as app code.
    "src-tauri/**",
    // Claude Code tooling scripts (Node.js CJS, not app code):
    ".claude/**",
    // Local-only debug/diagnostic scripts — not part of the app build:
    "scripts/debug/**",
    // Extracted design mockups / design-system helpers (gitignored, not app code):
    ".mockups-extracted/**",
    // Local-only desktop/Electron build output dirs — not in a fresh CI checkout:
    "release/**",
    "dist-desktop/**",
    // Claude Code planning/tooling scripts (gitignored, not app code):
    ".superpowers/**",
    // serwist's compiled service worker (build artifact written into public/
    // by the static build, gitignored — see .gitignore) — minified vendor
    // bundle, not hand-written app code.
    "public/sw.js",
    // MapLibre worker/shared bundles copied from node_modules by
    // scripts/copy-maplibre-worker.mjs before dev/build (gitignored) — vendor
    // dist code, not app source.
    "public/maplibre/**",
    // Local Playwright screenshot/probe scratch scripts (gitignored):
    ".playwright-screenshots/**",
  ]),
]);

export default eslintConfig;
