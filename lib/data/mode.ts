export type DataMode = 'http' | 'local';

/**
 * Build-time data mode. `NEXT_PUBLIC_` so it is inlined into the client bundle
 * and statically tree-shakeable. Defaults to 'http' (the hosted app).
 */
export const DATA_MODE: DataMode =
  process.env.NEXT_PUBLIC_DATA_MODE === 'local' ? 'local' : 'http';
