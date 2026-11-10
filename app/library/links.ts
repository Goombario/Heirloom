// Library links that mean Sources. A bare /library opens Photos (#1157), so every
// link to a source says tab=sources: the source opens over the Sources tab, and
// closing it leaves you there.

export const LIBRARY_SOURCES_HREF = '/library?tab=sources';

export function librarySourceHref(id: number | string): string {
  return `${LIBRARY_SOURCES_HREF}&source=${id}`;
}
