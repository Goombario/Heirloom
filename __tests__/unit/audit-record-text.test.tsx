/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import React from 'react';
import en from '@/messages/en.json';
import { useAuditDescription, useAuditRecord } from '@/app/audit/useAuditRecord';
import type { AuditLogEntryWithUser } from '@/lib/db/schema';
import type { AuditRecord } from '@/lib/data/types';

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>
);

const entry = (over: Partial<AuditLogEntryWithUser>): AuditLogEntryWithUser => ({
    Id: 1, TreeOwnerId: 1, UserId: 1, Action: 'update', EntityType: 'event', EntityId: 9, EntityLabel: 'Birth — Hazel Bracken',
    Changes: { fields: {} }, CreatedAt: '2026-10-25T00:00:00Z', UserName: null, UserEmail: null, ...over,
} as AuditLogEntryWithUser);

function recordText(record: AuditRecord | undefined, e = entry({})) {
    const { result } = renderHook(() => useAuditRecord(record ? { [e.Id]: record } : {}), { wrapper });
    return result.current(e);
}

const person = (over: Partial<AuditRecord> = {}): AuditRecord => ({ kind: 'person', id: 3, name: 'Hazel Bracken', live: true, item: null, ...over });

/** The Record column is one line naming what changed and whose it is (#930). */
describe('useAuditRecord', () => {
    it('names a record on its own and links it', () => {
        const text = recordText(person());
        expect(text.name).toBe('Hazel Bracken');
        expect(text.href).toBe('/people/view?id=3');
        render(<>{text.node(true)}</>, { wrapper });
        expect(screen.getByRole('link', { name: 'Hazel Bracken' })).toHaveAttribute('href', '/people/view?id=3');
    });

    it('names a journal entry by its case (#1227)', () => {
        const text = recordText({ kind: 'case', id: 5, name: 'Who were Ada’s parents?', live: true, item: { kind: 'journalEntry' } });
        expect(text.name).toBe('Journal entry on Who were Ada’s parents?');
        expect(text.href).toBe('/cases/view?id=5');
    });

    it('names the child and the family of a child link, each linked', () => {
        const family: AuditRecord = { kind: 'family', id: 4, name: 'Tom Bracken & Mary Bracken', live: true, item: { kind: 'child', id: 3, name: 'Hazel Bracken', live: true } };
        const text = recordText(family);
        expect(text.name).toBe('Hazel Bracken as child of Tom Bracken & Mary Bracken');
        render(<>{text.node(true)}</>, { wrapper });
        expect(screen.getByRole('link', { name: 'Hazel Bracken' })).toHaveAttribute('href', '/people/view?id=3');
        expect(screen.getByRole('link', { name: 'Tom Bracken & Mary Bracken' })).toHaveAttribute('href', '/families/view?id=4');
    });

    it('keeps a deleted record\'s saved name, unlinked and tagged', () => {
        const family: AuditRecord = { kind: 'family', id: 4, name: 'Tom Gone & Mary Gone', live: false, item: { kind: 'child', id: 3, name: 'Hazel Gone', live: false } };
        const text = recordText(family);
        expect(text.gone).toBe(true);
        render(<>{text.node(true)}</>, { wrapper });
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getAllByText('deleted')).toHaveLength(2);
    });

    it('words events, citations, tags and gone records', () => {
        expect(recordText(person({ item: { kind: 'event', code: 'OCCU' } })).name).toBe('Occupation of Hazel Bracken');
        expect(recordText(person({ item: { kind: 'citation', fact: 'birth', eventCode: null, source: '1901 Census' } })).name)
            .toBe('Birth of Hazel Bracken, cited from 1901 Census');
        expect(recordText(person({ item: { kind: 'photoTag', photo: 'Wedding' } })).name).toBe('Hazel Bracken tagged in Wedding');
        expect(recordText(person({ name: null, live: false, item: { kind: 'event', code: 'BIRT' } })).name).toBe('Birth of a deleted person');
        expect(recordText({ kind: null, id: null, name: null, live: false, item: null }).name).toBe('A record no longer in the tree');
    });

    it('falls back to the saved label when the server sent no record', () => {
        expect(recordText(undefined).name).toBe('Birth — Hazel Bracken');
    });
});

describe('useAuditDescription', () => {
    const describeEntry = (e: AuditLogEntryWithUser) => renderHook(() => useAuditDescription(), { wrapper }).result.current(e);

    it('moves a place rename and an import into Changes', () => {
        expect(describeEntry(entry({ EntityType: 'place', Changes: { snapshot: { from: 'Dovr', to: 'Dover', wasMerge: false, affected: [{}, {}] } } })))
            .toBe('Renamed Dovr → Dover · 2 records');
        expect(describeEntry(entry({ EntityType: 'import', Action: 'create', Changes: { snapshot: { mode: 'merge', people: 1, families: 2 } } })))
            .toBe('Imported into the tree · 1 person, 2 families');
    });

    it('says an unused place was deleted (#1229)', () => {
        expect(describeEntry(entry({ EntityType: 'place', Action: 'delete', Changes: { snapshot: { deleted: true, name: 'Lviv', place: { Id: 4 }, names: [] } } })))
            .toBe('Deleted Lviv, which nothing used');
    });

    it('says a profile picture was set or removed', () => {
        const fields = (n: number | null) => ({ summary: { kind: 'canonical_primary' }, fields: { CanonicalPrimaryMediaId: { old: 1, new: n } } });
        expect(describeEntry(entry({ EntityType: 'media', Changes: fields(5) as never }))).toBe('Set as profile picture');
        expect(describeEntry(entry({ EntityType: 'media', Changes: fields(null) as never }))).toBe('Profile picture removed');
    });

    it('leaves ordinary entries to their field changes', () => {
        expect(describeEntry(entry({}))).toBeNull();
    });
});
