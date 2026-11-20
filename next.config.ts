import type { NextConfig } from "next";
import path from "path";
import withSerwistInit from "@serwist/next";
import { version } from "./package.json";
import { aboutBuildEnv } from "./lib/about/build-env";

// Static / local-first build target: swap the DB connection module for the
// PGlite (in-browser) implementation so all query files run against WASM
// Postgres. Keyed on BUILD_TARGET so the default (hosted) build is unaffected.
const isStatic = process.env.BUILD_TARGET === 'static';

// Env-driven base path. Cloudflare Pages serves from the root of a *.pages.dev
// subdomain (or a custom domain), so the default is empty. Set NEXT_PUBLIC_BASE_PATH
// to a subpath (e.g. '/genealogy-nextjs') only if you front the site with a
// path-based proxy — no code change needed.
const basePath = isStatic ? (process.env.NEXT_PUBLIC_BASE_PATH ?? '') : '';

// Node-only built-ins that `pg` imports. `getDataClient()` is reachable from
// always-loaded client components, so the bundler compiles the pg-backed Local
// client's module graph even in hosted mode (where it never runs). Stub these to
// an empty module in the *browser* bundle so that dead branch resolves without
// dragging Node internals client-side. The server build keeps the real modules.
const browserNodeStubs = {
  fs: { browser: './lib/empty.ts' },
  net: { browser: './lib/empty.ts' },
  tls: { browser: './lib/empty.ts' },
  dns: { browser: './lib/empty.ts' },
  // The local media client imports lib/db/queries/media.ts (for createMedia),
  // which pulls in lib/media-thumbnail.ts → sharp (+ fs/promises, child_process
  // via detect-libc). sharp is server-only (thumbnail/cleanup paths never run in
  // the browser). Aliasing sharp to the empty stub drops its whole Node subtree;
  // fs/promises is stubbed for media-thumbnail's own import. See lib/empty.ts.
  sharp: { browser: './lib/empty.ts' },
  'fs/promises': { browser: './lib/empty.ts' },
  // @electric-sql/pglite-tools' pg_dump imports `createRequire` from Node's
  // `module` builtin in a Node-only code path. It can't resolve in the browser
  // bundle (breaks the whole app with "Can't resolve 'module'"); the browser
  // path never calls createRequire, so stub it out. See lib/empty.ts.
  module: { browser: './lib/empty.ts' },
};

// Origins the map may contact, derived from the configurable style URLs so a
// custom NEXT_PUBLIC_MAP_STYLE_URL host is covered too (default: OpenFreeMap).
function mapOrigins(): string[] {
  const urls = [
    process.env.NEXT_PUBLIC_MAP_STYLE_URL,
    process.env.NEXT_PUBLIC_MAP_STYLE_URL_DARK,
    'https://tiles.openfreemap.org',
  ].filter(Boolean) as string[];
  const origins = new Set<string>();
  for (const u of urls) {
    try { origins.add(new URL(u).origin); } catch { /* ignore malformed */ }
  }
  return [...origins];
}

// App-wide Content-Security-Policy. Now ENFORCING: a local production build
// (Playwright, securitypolicyviolation listeners) verified zero violations on
// home/people/tree/places/places-map/library/cases and the location autocomplete,
// including MapLibre's blob: workers. The two things the sandbox couldn't reach
// were then confirmed on a machine with real network access (2026-07-02):
//   - OpenFreeMap sub-requests: the tile/glyph/sprite/style URLs inside the
//     positron style JSON all resolve to https://tiles.openfreemap.org (already
//     allowlisted) and returned 200 on a rendered place map — zero reports.
//   - Authenticated surface: the enforced-auth /auth/signin page is clean, and
//     session.user.image is only persisted to the DB, never rendered (UserMenu /
//     MobileDrawer draw initials), so a real Google session adds no new origin —
//     no googleusercontent.com img-src entry is needed.
//   - script-src 'unsafe-inline': Next.js inline bootstrap + the theme-flash
//     inline <script> in app/layout.tsx. (No external script CDNs — D3 is npm-only.)
//   - style-src / style-src-attr 'unsafe-inline': Tailwind + ~1k inline style={{}}.
//   - worker-src blob: + img-src blob:/data: + map origins: MapLibre GL (web
//     workers, tile canvases) and its tiles/glyphs/sprites.
//   - connect-src: same map origins + Photon geocoder (client autocomplete).
//   - accounts.google.com (script/frame/connect) + www.googleapis.com (connect):
//     Google Identity Services + Drive REST for the optional Drive backup feature
//     (only loaded when NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID is set).
function contentSecurityPolicy(): string {
  const map = mapOrigins().join(' ');
  // React/Turbopack use eval() in dev for HMR + callstack reconstruction. Prod
  // never calls eval(), so 'unsafe-eval' is dev-only — the enforced policy stays strict.
  const devEval = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${devEval} https://accounts.google.com`,
    "style-src 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob: ${map}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "frame-src 'self' https://accounts.google.com",
    `connect-src 'self' ${map} https://photon.komoot.io https://accounts.google.com https://www.googleapis.com`,
  ].join('; ');
}

const nextConfig: NextConfig = {
  // The app version, from package.json, for the phone home's sign-off (#1061),
  // plus the About page's build commit, date, source link and kind (#1256).
  env: { NEXT_PUBLIC_APP_VERSION: version, ...aboutBuildEnv() },

  // Dev only: hosts other than localhost (a phone on the LAN) that may load dev
  // resources and HMR. Comma-separated in DEV_ALLOWED_ORIGINS, e.g. in .env.local.
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(',').map((h) => h.trim()).filter(Boolean),

  turbopack: {
    resolveAlias: {
      ...(isStatic ? { '@/lib/db/connection': './lib/db/connection.pglite.ts' } : {}),
      ...browserNodeStubs,
    },
  },

  // Same connection-module swap + client-side Node fallbacks for the webpack
  // builder (next build --webpack, used by build:static; and dev:webpack).
  webpack: (config, { isServer, webpack }) => {
    if (isStatic) {
      // NOT resolve.alias. An alias keyed '@/lib/db/connection$' never fires for the
      // tsconfig `@/*` requests these files use — verified by pointing it at a
      // nonexistent file and still getting a clean build. It silently no-op'd, so the
      // real pg connection.ts (and pg itself) got bundled into the static export, and
      // /audit threw "DATABASE_URL environment variable is not set" on Cloudflare and
      // Tauri. dev:static hid it because `next dev` uses Turbopack, whose resolveAlias
      // above does work. NormalModuleReplacementPlugin matches the request as written
      // in source, which is what we need here.
      // Guarded by scripts/assert-static-no-pg.mjs, which fails build:static on regress.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^@\/lib\/db\/connection$/,
          path.resolve(__dirname, 'lib/db/connection.pglite.ts'),
        ),
      );
    }
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        'fs/promises': false,
        child_process: false,
        // pglite-tools' pg_dump references Node's `module` (createRequire) in a
        // Node-only branch; stub it out of the browser bundle (build:static/webpack).
        module: false,
      };
      config.resolve.alias = {
        ...config.resolve.alias,
        sharp: path.resolve(__dirname, 'lib/empty.ts'),
      };
    }
    return config;
  },

  experimental: {
    // Allow large GEDCOM zip imports (default is 10MB)
    proxyClientMaxBodySize: 200 * 1024 * 1024,
  },

  // Static export drops the standalone server; hosted keeps standalone for Railway.
  output: isStatic ? 'export' : 'standalone',

  // The static build temporarily stashes app/api and proxy.ts because they are
  // server-only. Its TypeScript project must therefore omit integration tests
  // that import those routes; the hosted build keeps the full project config.
  typescript: {
    tsconfigPath: isStatic ? 'tsconfig.static.json' : 'tsconfig.json',
  },

  // basePath and assetPrefix are only set when serving under a subpath.
  // Empty string (the Cloudflare Pages default) means serve from root.
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),

  // pg and sharp are Node-only and irrelevant in the static (export) build.
  // exceljs is loaded by Node instead of bundled in both builds: its Node entry
  // reaches unzipper@0.12, whose S3 helper has a lazy require of the optional
  // @aws-sdk/client-s3. Nothing calls it, but the bundler still tries to
  // resolve it and fails. Browser bundles use exceljs's own prebuilt browser
  // file, which has no unzipper, so they are unaffected.
  serverExternalPackages: isStatic ? ['exceljs'] : ['pg', 'sharp', 'exceljs'],

  // Security headers are server-sent — no-op in static export (no server).
  ...(isStatic ? {} : {
    async headers() {
      return [{
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      }, {
        // The media file route sets its own frame and CSP headers: the media
        // viewer frames a PDF there (#510), which X-Frame-Options DENY and the
        // app's frame-ancestors 'none' would block. Every other path gets both.
        source: '/((?!api/media/[^/]+/file$).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          // Enforcing — verified zero violations on a local prod build across all
          // pages, then the two sandbox-unreachable items (live OpenFreeMap tile/
          // glyph/sprite sub-requests on a rendered map, and the enforced-auth
          // surface) confirmed clean on a networked machine (2026-07-02).
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
        ],
      }];
    },
  }),
};

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  register: false, // manual registration — see RegisterServiceWorker.tsx, so it can be skipped inside Tauri
  disable: !isStatic, // no-op entirely for the hosted build
});

export default withSerwist(nextConfig);
