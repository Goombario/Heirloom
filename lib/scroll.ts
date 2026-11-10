/**
 * Reset scroll to the top of whichever element actually scrolls: the mobile
 * app-shell inner scroller (.app-scroll) and/or the desktop document. Calling
 * both is safe — the non-scrolling one is a harmless no-op on each breakpoint.
 */
export function scrollToTop(smooth = false): void {
  const opts: ScrollToOptions = { top: 0, left: 0, behavior: smooth ? 'smooth' : 'auto' };
  if (typeof window !== 'undefined') window.scrollTo(opts);
  document.querySelector('.app-scroll')?.scrollTo(opts);
}
