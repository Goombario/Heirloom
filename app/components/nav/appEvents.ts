/**
 * App-wide requests a screen can make without owning the chrome: the mobile list
 * header's glass buttons (#1058) open the same menu drawer and global search as the
 * app top bar. `Navbar` and `GlobalSearch` listen for these on `document`.
 */
export const OPEN_APP_MENU = 'open-app-menu';
const OPEN_GLOBAL_SEARCH = 'open-global-search';

export function openAppMenu(): void {
  document.dispatchEvent(new CustomEvent(OPEN_APP_MENU));
}

export function openGlobalSearch(): void {
  document.dispatchEvent(new CustomEvent(OPEN_GLOBAL_SEARCH));
}
