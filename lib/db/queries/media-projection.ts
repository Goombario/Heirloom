/**
 * Public Media projection. Upload replay identity is operational state and must
 * only be selected by the dedicated intent lookup.
 */
const PUBLIC_MEDIA_COLUMNS = [
  'Id', 'UserId', 'TreeId', 'Title', 'Date', 'FilePath', 'SourceFile', 'Format', 'ContentType',
  'FocalX', 'FocalY', 'FocalRadius', 'FileSize', 'ContentHash',
] as const;

/** The public columns, optionally from `alias`, and renamed with `as` in front ("media_Id") for a join. */
export function publicMediaColumns(alias?: string, as?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return PUBLIC_MEDIA_COLUMNS.map(column => `${prefix}"${column}"${as ? ` AS "${as}${column}"` : ''}`).join(', ');
}
