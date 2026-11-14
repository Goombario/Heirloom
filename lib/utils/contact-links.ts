import { isWebUrl } from '@/lib/desktop';

/**
 * Where a repository's contact field links to (ADR 0049), or null when it shouldn't
 * be a link. Values come from imported files as well as the editor, so a website is a
 * link only when it is http(s), never `javascript:` or anything else.
 */
export function contactHref(kind: 'Website' | 'Phone' | 'Email', value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (kind === 'Website') return isWebUrl(v) ? v : null;
  if (kind === 'Email') return /^[^\s@:/?#]+@[^\s@:/?#]+$/.test(v) ? `mailto:${v}` : null;
  const dial = v.replace(/[^\d+]/g, '');
  return /\d/.test(dial) ? `tel:${dial}` : null;
}
