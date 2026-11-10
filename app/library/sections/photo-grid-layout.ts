// Four fixed columns from lg up. The grid can't grow past about 828px: PageShell's
// `list` column caps at max-w-6xl (1152) and loses sm:px-6, the 220px filter rail and
// the main column's px-7. An xl `auto-fill` with a 200px minimum track needed 830px
// for four, so it could only ever take a column away above 1280px (#886). If that
// width changes, re-check four columns still fit before adding auto-fill back.
export const PHOTO_GRID_COLUMNS_CLASS = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';

export const PHOTO_GRID_GAP_PX = 10;
