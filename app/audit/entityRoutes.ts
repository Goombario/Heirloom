import { librarySourceHref } from '@/app/library/links';
import type { AuditRecord, AuditRecordKind } from '@/lib/data/types';
import { placeHref } from '@/lib/places/place-key';

/**
 * Record kind → detail-page URL. The audit log used to build these inline as
 * `${basePath}/${id}`, which produced /people/15612 where the route is actually
 * /people/view?id=15612 — every record link 404d.
 *
 * Since #930 the Record column links the record an entry belongs to, not the
 * entry's own row, so events, tags, citations and child links open their
 * person or family. A place page opens by the place's id, or by the name the
 * entry saved when it has none.
 * `null` means the kind has no page: a photo, or the whole tree for an import.
 */
const RECORD_ROUTES: Record<AuditRecordKind, ((record: AuditRecord) => string | null) | null> = {
  person: (r) => (r.id == null ? null : `/people/view?id=${r.id}`),
  family: (r) => (r.id == null ? null : `/families/view?id=${r.id}`),
  case: (r) => (r.id == null ? null : `/cases/view?id=${r.id}`),
  source: (r) => (r.id == null ? null : librarySourceHref(r.id)),
  place: (r) => (r.id != null ? placeHref({ id: r.id, name: r.name ?? '' }) : r.name ? placeHref({ name: r.name }) : null),
  media: null,
  tree: null,
};

/** The page of the record an audit entry belongs to, or null when it has none. */
export function recordHref(record: AuditRecord): string | null {
  return record.kind ? RECORD_ROUTES[record.kind]?.(record) ?? null : null;
}
