import type { GedcomImportWarning } from '@/lib/data/types';

export type GedcomWarningTranslator = (
  key:
    | 'warning_sidecar_newer_version'
    | 'warning_merge_xref_name_mismatch'
    | 'warning_family_extra_partners'
    | 'warning_charset_guessed'
    | 'warning_dropped_links'
    | 'warning_duplicate_xrefs'
    | 'warning_child_relationship_unmapped'
    | 'warning_inline_citations_kept'
    | 'warning_citations_unplaced'
    | 'warning_custom_records_dropped'
    | 'warning_media_blobs_dropped'
    | 'warning_notes_unattached'
    | 'warning_place_lines_dropped'
    | 'warning_raw_pointers_dropped'
    | 'warning_external_media_references'
    | 'warning_merge_media_without_files'
    | 'warning_media_cleanup_failed'
    | 'warning_places_shared_name',
  values: GedcomImportWarning['values'],
) => string;

/** Translate server-produced GEDCOM warnings at the UI boundary. */
export function formatGedcomImportWarning(
  warning: GedcomImportWarning,
  translate: GedcomWarningTranslator,
): string {
  switch (warning.code) {
    case 'merge_xref_name_mismatch':
      return translate('warning_merge_xref_name_mismatch', warning.values);
    case 'family_extra_partners':
      return translate('warning_family_extra_partners', warning.values);
    case 'dropped_links':
      return translate('warning_dropped_links', warning.values);
    case 'duplicate_xrefs':
      return translate('warning_duplicate_xrefs', warning.values);
    case 'child_relationship_unmapped':
      return translate('warning_child_relationship_unmapped', warning.values);
    case 'inline_citations_kept':
      return translate('warning_inline_citations_kept', warning.values);
    case 'citations_unplaced':
      return translate('warning_citations_unplaced', warning.values);
    case 'custom_records_dropped':
      return translate('warning_custom_records_dropped', warning.values);
    case 'media_blobs_dropped':
      return translate('warning_media_blobs_dropped', warning.values);
    case 'notes_unattached':
      return translate('warning_notes_unattached', warning.values);
    case 'place_lines_dropped':
      return translate('warning_place_lines_dropped', warning.values);
    case 'raw_pointers_dropped':
      return translate('warning_raw_pointers_dropped', warning.values);
    case 'charset_guessed':
      return translate('warning_charset_guessed', warning.values);
    case 'external_media_references':
      return translate('warning_external_media_references', warning.values);
    case 'merge_media_without_files':
      return translate('warning_merge_media_without_files', warning.values);
    case 'media_cleanup_failed':
      return translate('warning_media_cleanup_failed', warning.values);
    case 'places_shared_name':
      return translate('warning_places_shared_name', warning.values);
    case 'sidecar_version_newer':
      return translate('warning_sidecar_newer_version', warning.values);
  }
}
