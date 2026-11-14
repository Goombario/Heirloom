/**
 * The Tauri desktop shell (#1020).
 *
 * Tauri v2 always injects `__TAURI_INTERNALS__`. It only injects `__TAURI__`
 * when `app.withGlobalTauri` is true in tauri.conf.json — which this project
 * does NOT set, so `__TAURI__` alone would never match. Check both so enabling
 * withGlobalTauri later can't silently change this.
 */
export function isDesktopApp(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

/** Only web links leave the app; the opener capability allows nothing else. */
export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/**
 * Open a web link in the system browser from the desktop app. The plugin is
 * loaded on demand so web and static builds never fetch it. The opener only
 * allows https (#51, L-12), so a plain http link is opened as https.
 */
export async function openInSystemBrowser(url: string): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url.trim().replace(/^http:\/\//i, 'https://'));
}

/**
 * The smallest desktop window content, in CSS px. tauri.conf.json's
 * `minWidth`/`minHeight` match it, and the width stays above the 767px phone
 * breakpoint so a desktop window never shows the phone layout (#85).
 */
export const DESKTOP_MIN_CONTENT = { width: 800, height: 600 } as const;

/**
 * The px size of 1rem inside a media query, found by bisecting `min-width`
 * against the current viewport width. It is normally 16, but WebKitGTK scales it
 * by the page zoom, so with a desktop text scale its `md` breakpoint (48rem)
 * sits above 768 CSS px.
 */
export function mediaQueryRemPx(): number {
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (window.matchMedia(`(min-width: ${mid}rem)`).matches) lo = mid;
    else hi = mid;
  }
  return lo > 0 ? window.innerWidth / lo : 16;
}

/**
 * The window minimum, in logical px, that keeps the content as wide as
 * DESKTOP_MIN_CONTENT is at the default zoom, measured against the layout's rem
 * breakpoints. Two things shrink it on Linux with a desktop text scale
 * (Xft.dpi, GDK_DPI_SCALE): WebKitGTK zooms the page, so devicePixelRatio
 * exceeds the window's scale factor, and it scales media-query rems by that
 * zoom too. At a 1.25 text scale the configured 800px minimum left 640 CSS px
 * against a 960px `md` breakpoint: the phone layout.
 */
export function desktopMinLogicalSize(devicePixelRatio: number, scaleFactor: number, remPx = 16): { width: number; height: number } {
  const factor = Math.max(1, devicePixelRatio / scaleFactor) * Math.max(1, remPx / 16);
  return {
    width: Math.ceil(DESKTOP_MIN_CONTENT.width * factor),
    height: Math.ceil(DESKTOP_MIN_CONTENT.height * factor),
  };
}

/**
 * Raise the desktop window's minimum size to cover the webview's zoom, and grow
 * the window if it is already smaller: a new minimum alone does not resize it.
 * The minimum never exceeds the monitor; a screen too small for the desktop
 * layout keeps the phone layout rather than a window larger than the screen.
 */
export async function fitDesktopMinSize(): Promise<void> {
  const { currentMonitor, getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const min = desktopMinLogicalSize(window.devicePixelRatio, scale, mediaQueryRemPx());
  const monitor = await currentMonitor();
  if (monitor) {
    const { width, height } = monitor.workArea.size.toLogical(monitor.scaleFactor);
    min.width = Math.min(min.width, Math.floor(width));
    min.height = Math.min(min.height, Math.floor(height));
  }
  await win.setMinSize(new LogicalSize(min.width, min.height));
  const size = (await win.innerSize()).toLogical(scale);
  if (size.width >= min.width && size.height >= min.height) return;
  await win.setSize(new LogicalSize(Math.max(size.width, min.width), Math.max(size.height, min.height)));
}
