/**
 * Where a tree switch sends the user (#916). A record page names a record in
 * the tree being left, so after a switch it would say "This person isn't in
 * your tree". Record pages go to their section's list instead; list and global
 * pages stay put and reload under the new tree.
 *
 * Pure: takes the current path and query, returns the URL to go to, or null to
 * stay.
 */

const RECORD_ROUTES: Record<string, string> = {
    '/people/view': '/people',
    '/families/view': '/families',
    '/cases/view': '/cases',
    '/cases/new': '/cases',
    '/places/view': '/places',
    '/library/view': '/library?tab=sources',
};

export function treeSwitchTarget(pathname: string, search: string): string | null {
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    const section = RECORD_ROUTES[path];
    if (section) return section;
    const params = new URLSearchParams(search);
    // The tree opens at the new tree's own root person.
    if (path === '/tree') return params.has('rootId') ? '/tree' : null;
    // A source or repository opens as a modal over the list: drop it, keep the tab.
    if (path === '/library') {
        const tab = params.get('tab');
        const kept = tab ? `/library?tab=${encodeURIComponent(tab)}` : '/library';
        return [...params.keys()].some((key) => key !== 'tab') ? kept : null;
    }
    return null;
}
