import { describe, it, expect } from 'vitest';
import { recordHref } from '@/app/audit/entityRoutes';
import { AUDITABLE_ENTITY_TYPES } from '@/lib/db/queries/audit';
import type { AuditRecord } from '@/lib/data/types';

const record = (kind: AuditRecord['kind'], id: number | null, name: string | null = null): AuditRecord =>
    ({ kind, id, name, live: true, item: null });

/**
 * The audit log built its record links as `${basePath}/${EntityId}`, producing
 * /people/15612 where the route is actually /people/view?id=15612 — so every
 * linked record 404d. Since #930 the link goes to the record an entry belongs to.
 */
describe('recordHref', () => {
    it('builds the real person detail URL', () => {
        expect(recordHref(record('person', 15612))).toBe('/people/view?id=15612');
    });

    it('builds the real family detail URL', () => {
        expect(recordHref(record('family', 42))).toBe('/families/view?id=42');
    });

    it('builds the real case detail URL', () => {
        expect(recordHref(record('case', 7))).toBe('/cases/view?id=7');
    });

    // The Library reads ?source=, not ?sourceId=, and a bare /library opens Photos (#1157).
    it('opens a source over the Library Sources tab', () => {
        expect(recordHref(record('source', 12))).toBe('/library?tab=sources&source=12');
    });

    // /places/view is keyed by ?name=, so a place links by the name its record carries.
    it('links a place by id, or by the saved name when it has none (#1186)', () => {
        expect(recordHref(record('place', 93, 'Dover, Kent'))).toBe('/places/view?id=93');
        expect(recordHref(record('place', null, 'Dover, Kent'))).toBe('/places/view?name=Dover%2C%20Kent');
        expect(recordHref(record('place', null))).toBeNull();
    });

    it('returns null for a photo, the whole tree, or an unknown record', () => {
        expect(recordHref(record('media', 10, 'Wedding'))).toBeNull();
        expect(recordHref(record('tree', null, 'My tree'))).toBeNull();
        expect(recordHref(record(null, null))).toBeNull();
    });

    // The Type column renders t('filter_' + EntityType) for every row. A missing
    // key does not throw — next-intl prints the raw key path into the table — so
    // the audit-log Type cell would read "audit.filter_place" in production.
    // (That is exactly what happened: 'place' had no label.)
    it('has a Type-column label for every entity type, in every language', async () => {
        for (const lang of ['en', 'fr', 'ru']) {
            const messages = (await import(`@/messages/${lang}.json`)).default as Record<string, Record<string, string>>;
            for (const entityType of AUDITABLE_ENTITY_TYPES) {
                expect(
                    messages.audit[`filter_${entityType}`],
                    `messages/${lang}.json audit.filter_${entityType} is missing`,
                ).toBeTruthy();
            }
        }
    });
});
