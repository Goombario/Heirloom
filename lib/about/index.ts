import { DATA_MODE, type DataMode } from '@/lib/data';
import { isDesktopApp } from '@/lib/desktop';

/** The licence text bundled with every build (public/licenses). */
export const LICENSE_HREF = '/licenses/agpl-3.0.txt';
/** Third-party notices, written at build time by scripts/third-party-licenses.mjs. */
export const CREDITS_HREF = '/third-party-licenses.txt';

export type RunningAs = 'hosted' | 'self_hosted' | 'browser' | 'desktop';

export interface AboutInfo {
  version: string;
  commit: string;
  /** YYYY-MM-DD, or '' when unknown. */
  buildDate: string;
  sourceUrl: string;
}

/**
 * Build facts for the About page and the menu rows (#1256). Each NEXT_PUBLIC_*
 * is read by its literal name so Next inlines it; next.config.ts sets them.
 */
export function aboutInfo(): AboutInfo {
  return {
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? '',
    commit: process.env.NEXT_PUBLIC_BUILD_COMMIT ?? '',
    buildDate: process.env.NEXT_PUBLIC_BUILD_DATE ?? '',
    sourceUrl: process.env.NEXT_PUBLIC_SOURCE_URL ?? '',
  };
}

/** Which of the four build kinds this is. The desktop app is the static build inside Tauri. */
export function runningAs(
  mode: DataMode = DATA_MODE,
  desktop: boolean = isDesktopApp(),
  hosted: boolean = process.env.NEXT_PUBLIC_HOSTED === 'true',
): RunningAs {
  if (desktop) return 'desktop';
  if (mode === 'local') return 'browser';
  return hosted ? 'hosted' : 'self_hosted';
}
