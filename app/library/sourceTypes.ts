// Source type vocabulary shared by the Library filter rail and source cards.
import { createElement, type ComponentProps } from 'react';
import { Camera, Church, FileText, Landmark, Mic, Newspaper, ScrollText, Stamp, type LucideIcon } from '@/lib/icons';

// Mirrors the SOURCE_TYPES list in lib/db/queries/sources.ts (display order).
export const SOURCE_TYPES = [
  'Census',
  'Vital',
  'Church',
  'Newspaper',
  'Oral',
  'Document',
  'Photo',
  'Other',
] as const;

const KNOWN_SOURCE_TYPES: ReadonlySet<string> = new Set<string>(SOURCE_TYPES);

/**
 * Translate a raw source Type value. Known types map to the `type_*` i18n keys;
 * unknown / custom values fall back to the raw string. `null` → "Document".
 */
export function sourceTypeLabel(
  type: string | null,
  t: (key: string) => string,
): string {
  const value = type ?? 'Document';
  return KNOWN_SOURCE_TYPES.has(value) ? t(`type_${value}`) : value;
}

const SOURCE_TYPE_ICON: Record<(typeof SOURCE_TYPES)[number], LucideIcon> = {
  Census: Landmark,
  Vital: Stamp,
  Church,
  Newspaper,
  Oral: Mic,
  Document: FileText,
  Photo: Camera,
  Other: ScrollText,
};

/**
 * The glyph a source card shows in place of a thumbnail (#765, LY-5). `null` → Document;
 * a custom type → the generic scroll.
 */
export function SourceTypeIcon({ sourceType, ...props }: { sourceType: string | null } & ComponentProps<LucideIcon>) {
  const value = sourceType ?? 'Document';
  const icon = KNOWN_SOURCE_TYPES.has(value) ? SOURCE_TYPE_ICON[value as (typeof SOURCE_TYPES)[number]] : ScrollText;
  return createElement(icon, props);
}
