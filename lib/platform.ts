/**
 * Platform detection helper for OS-specific UI hints (keyboard shortcuts, etc.).
 * Safe to call in either server or client; on the server it returns false
 * (and any UI relying on it should re-render after hydration).
 */
export function isMac(): boolean {
    if (typeof navigator === 'undefined') return false;
    // navigator.platform is deprecated but still the most reliable Mac check.
    // userAgentData would be better but isn't available in Safari.
    return /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
}
