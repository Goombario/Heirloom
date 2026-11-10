import type { MetadataRoute } from 'next';

// Required for the static export (output: 'export'): generate the manifest at
// build time. The env var is read once per build — fine, since each environment
// (Railway dev/prod, Cloudflare) builds separately with its own env, so the
// per-environment name still bakes in correctly.
export const dynamic = 'force-static';

/**
 * Web app manifest — served at /manifest.webmanifest. Dynamic so dev and prod
 * installs carry different names (they're already separate installs — different
 * Railway origins — this just labels them distinctly on the home screen).
 *
 * `RAILWAY_ENVIRONMENT_NAME` is Railway's standard auto-injected variable (its
 * value is the environment's name, e.g. "production" / "dev"). Fallback: a custom
 * NEXT_PUBLIC_APP_ENV per environment.
 *
 * Default is PROD-SAFE: the name is "Heirloom" unless the environment is
 * explicitly dev. That way the public static build (Cloudflare/Tauri), which sets
 * no env, installs as "Heirloom" — only the Railway dev environment (name "dev")
 * gets the "(Dev)" suffix.
 *
 * Under the static export (output: 'export') this runs at build time.
 */
export default function manifest(): MetadataRoute.Manifest {
  const envName = process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NEXT_PUBLIC_APP_ENV;
  const isDev = envName === 'dev' || envName === 'development';

  return {
    name: isDev ? 'Heirloom (Dev)' : 'Heirloom',
    short_name: isDev ? 'Heirloom Dev' : 'Heirloom',
    description: 'Organize your family tree securely and privately',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: '#475569',
    background_color: '#ECEAE5',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
