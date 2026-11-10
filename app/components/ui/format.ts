/**
 * `formatLifespan` moved to `lib/date-utils` so server-side code can use it
 * without importing across the app/ boundary — the faces queue pre-formats a
 * suggested person's years in `lib/services/media-faces.ts`. Re-exported here
 * because this is where UI code has always reached for it.
 */
export { formatLifespan } from '@/lib/date-utils';
