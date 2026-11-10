# Deploying the static app to Cloudflare

The **local-first static build** (in-browser PGlite, no server) can be served by a
**Cloudflare Worker** (Workers Static Assets). This repository has no deploy workflow
and holds no Cloudflare credentials: you connect Cloudflare's git integration
("Workers Builds") to **your own repository**, and Cloudflare builds and deploys the
branch you choose. The maintainer's static site is deployed this way from a separate
private repository that receives released tags, the same route as the hosted server.

## Fork safety and privacy

- **Connect Cloudflare to a repository only you can push to, and deploy one branch.**
  Set the production branch to a branch that only moves when you release (for example
  `release`), and set **Builds for non-production branches → Disabled**.
- **On a public repository, keep non-production builds off.** With them on, Cloudflare
  builds other branches and pull requests with your account's build credentials.
- Cloudflare's check on each built commit shows the build and Worker name, not the site
  address, but a Worker's `workers.dev` address includes your account's subdomain. If
  that should stay private, deploy from a private repository, as the maintainer does.

## How it works

1. A push to the production branch starts a Cloudflare build.
2. Cloudflare runs the **Build command**, `npm run build:static`, which produces a fully
   static `out/` (in-browser PGlite, no server layer). `BUILD_TARGET=static` and
   `NEXT_PUBLIC_DATA_MODE=local` come from the npm script itself.
3. Cloudflare runs the **Deploy command**, `npx wrangler deploy`, which reads
   [`wrangler.jsonc`](../wrangler.jsonc) at the repo root (the Worker name, `heirloom`,
   and `./out`) and promotes the upload to live traffic.
4. `wrangler.jsonc` sets `assets.not_found_handling: "single-page-application"`, so any
   unmatched path serves `index.html` with HTTP 200 and client-side routing handles deep
   links. (`out/404.html`, written by `scripts/build-static.mjs`, is a portable 404
   fallback for plain static hosts.)

> **Do not emit `out/_redirects`.** Workers Static Assets strips `.html`/`/index` and
> rejects a `/* /index.html 200` rule as an infinite loop, which fails the deploy. SPA
> fallback is handled entirely by `not_found_handling` above. `scripts/build-static.mjs`
> deliberately no longer writes a `_redirects` file — see the comment there.

## One-time setup (Cloudflare dashboard)

1. **Workers & Pages → Create → Import a repository**, or an existing Worker's
   **Settings → Build**, and connect your repository. If the Worker's name differs from
   `heirloom`, change `name` in `wrangler.jsonc` to match.
2. **Branch control:** production branch = your release branch; **Builds for
   non-production branches → Disabled**.
3. **Build command:** `npm run build:static`. **Deploy command:** `npx wrangler deploy`.
   **Root directory:** blank.
4. **Build variables:** `AUTH_SECRET=unused-in-static-build` (NextAuth reads it at build;
   the static build has no auth server). `NEXT_PUBLIC_BASE_PATH` only if you serve from a
   subpath.

   > **Node version.** The root `.node-version` file pins Node **24** for Cloudflare's
   > build. It must stay ≥ the `engines.node` floor in `package.json`: `.npmrc` sets
   > `engine-strict=true`, so an older Node fails `npm install` before `build:static`
   > runs. If the floor is bumped, bump `.node-version` in the same change.

The site serves at `https://heirloom.<your-subdomain>.workers.dev`. Add a custom domain
under the Worker's **Domains & Routes**; no rebuild is needed (base path is empty). To
redeploy, use **Retry deployment** in the dashboard.

## Local verification

```sh
npm run build:static          # writes out/ exactly as Cloudflare will (base path '')
npx serve out                 # or any static server; open the printed URL
```

Check: dashboard loads, create a person, navigate to `/people/view?id=…`, upload a photo
and reload.

## Cold-start (hard-load) performance

A hard load boots a fresh in-browser PGlite. The dominant cost is **not** the WASM/IDB
boot (~80 ms) — it is `initializeSchema`. The IndexedDB-backed VFS flushes to IndexedDB
after every statement, so running the ~80-statement schema init on every load cost ~20 s
even when every `… IF NOT EXISTS` statement was a no-op. Two optimizations (both in
PGlite-only files — the hosted Postgres path is untouched):

- **Schema-init gate** (`lib/db/connection.pglite.ts`): a `_SchemaMeta` row records
  `SCHEMA_VERSION` after a successful init. On later loads a single read skips the whole
  init when the stored version already matches. Reduced warm hard-load ~23 s → ~5 s.
- **`relaxedDurability` + one transaction** (`lib/db/pglite-worker.ts`): the unavoidable
  first-ever init (and any user write) no longer blocks on the IndexedDB flush. Reduced
  first-ever load ~28 s → ~4 s. Each write through the data client then waits for one
  durable flush before it resolves (`lib/data/local/durable-writes.ts`, #1033), so a
  reload after a save can't lose it. A batch of photos waits for one flush at the end
  (`withWriteBatch`, #1259): IDBFS rewrites each changed file whole.
- **`out/_headers`** (`scripts/build-static.mjs`): `/_next/static/*` is content-hashed, so
  it is marked `immutable` instead of Workers Static Assets' default `max-age=0,
  must-revalidate`, avoiding a revalidation round-trip per hard load (incl. the ~6 MB
  PGlite `.data`). Unlike `_redirects`, a `_headers` file is accepted by Workers Assets.

> ⚠️ **Bump `SCHEMA_VERSION`** (in `lib/db/init-schema.ts`) whenever you change any
> statement in `initializeSchema` — add a table/column/index/migration. The static build
> skips re-running init when the stored version matches, so an un-bumped change will NOT
> reach existing local databases. The hosted (pg.Pool) path ignores the constant.

## Console output (deployed)

Triaged across all pages. Two recurring entries, both benign:

- **`The resource … was preloaded using link preload but not used within a few seconds …`**
  (3 woff2 fonts, sometimes +1 CSS chunk). The font preloads are correctly formed
  (`as="font" crossorigin type="font/woff2"`); the CSS one is a Next router prefetch for a
  route not navigated to in time. Standard Next.js `next/font`/router behaviour, not a
  misconfiguration — no functional impact.
- **`Minified React error #418`** (one per page): a hydration mismatch from the client-only
  i18n/theme providers. Tracked/fixed separately on the `fix/hydration-mismatch` branch;
  not a deploy regression.
- RSC-prefetch `*.txt` 404s appear only under a dumb static server (`npx serve out`); they
  do **not** occur on Cloudflare (`not_found_handling` serves the SPA shell). Ignore.

## Migrating away from GitHub Pages

The old `.github/workflows/deploy-pages.yml` has been removed. If GitHub Pages was ever
enabled for this repo, disable it under **Settings → Pages → Source → None** so the two
hosts don't both serve stale builds.
