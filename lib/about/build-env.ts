import { execSync } from 'node:child_process';

/**
 * Build-time values for the About page (#1256), read once by next.config.ts and
 * inlined into the client bundle as NEXT_PUBLIC_* so every build kind (hosted,
 * static, desktop) shows them without a server.
 */
export interface AboutBuildEnv {
  NEXT_PUBLIC_BUILD_COMMIT: string;
  NEXT_PUBLIC_BUILD_DATE: string;
  NEXT_PUBLIC_SOURCE_URL: string;
  NEXT_PUBLIC_HOSTED: string;
}

type Env = Record<string, string | undefined>;

/**
 * Commit ids the build hosts already provide: an explicit SOURCE_COMMIT, Railway,
 * Cloudflare Workers Builds, Cloudflare Pages, GitHub Actions (desktop releases).
 */
const COMMIT_VARS = ['SOURCE_COMMIT', 'RAILWAY_GIT_COMMIT_SHA', 'WORKERS_CI_COMMIT_SHA', 'CF_PAGES_COMMIT_SHA', 'GITHUB_SHA'];

function gitHead(): string {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

/** The short commit, or '' when the build has no git and no host variable. */
export function buildCommit(env: Env, readGit: () => string = gitHead): string {
  const raw = COMMIT_VARS.map((k) => env[k]?.trim()).find(Boolean) ?? readGit();
  return /^[0-9a-f]{7,40}$/i.test(raw) ? raw.slice(0, 7).toLowerCase() : '';
}

/** Where the unmodified source lives: the default for the About page's source link. */
export const DEFAULT_SOURCE_URL = 'https://github.com/Goombario/Heirloom';

/**
 * The public source link. AGPL section 13 asks for one, so an unset value links
 * the upstream repository, and a self-hoster who changes the code points
 * SOURCE_URL at their fork. A set value that is not a web link hides the link.
 */
export function sourceUrl(env: Env): string {
  const raw = (env.SOURCE_URL ?? env.NEXT_PUBLIC_SOURCE_URL ?? '').trim();
  if (!raw) return DEFAULT_SOURCE_URL;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export function aboutBuildEnv(env: Env = process.env, now: Date = new Date(), readGit?: () => string): AboutBuildEnv {
  return {
    NEXT_PUBLIC_BUILD_COMMIT: buildCommit(env, readGit),
    NEXT_PUBLIC_BUILD_DATE: now.toISOString().slice(0, 10),
    NEXT_PUBLIC_SOURCE_URL: sourceUrl(env),
    // A managed instance run for other people says "Hosted server"; everything
    // else on a server is "Self-hosted server".
    NEXT_PUBLIC_HOSTED: /^(1|true|yes)$/i.test(env.HEIRLOOM_HOSTED?.trim() ?? '') ? 'true' : '',
  };
}
