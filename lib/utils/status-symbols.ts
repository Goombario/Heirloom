/**
 * "Status symbols" accessibility preference (Options → Accessibility, off by
 * default). When on, the living-status dot carries the genealogical marks,
 * † for deceased and ? for unknown, so status never depends on colour alone.
 *
 * Stored per device in localStorage and mirrored onto <html data-status-symbols>
 * so the CSS in globals.css can show the symbols without React plumbing; the
 * theme boot script in app/layout.tsx sets the attribute before first paint.
 */
const STATUS_SYMBOLS_KEY = 'statusSymbols';

export function readStatusSymbols(): boolean {
  try {
    return localStorage.getItem(STATUS_SYMBOLS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeStatusSymbols(on: boolean): void {
  try {
    localStorage.setItem(STATUS_SYMBOLS_KEY, String(on));
  } catch {
    // Storage unavailable: the attribute below still applies for this page view.
  }
  if (on) document.documentElement.setAttribute('data-status-symbols', 'on');
  else document.documentElement.removeAttribute('data-status-symbols');
}
