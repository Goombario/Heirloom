import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { auditFieldSpec, auditRefIds } from '@/lib/utils/audit-fields';

/** #551: the audit log shows field labels and names, never columns and ids. */
describe('auditFieldSpec', () => {
    // Every field a user can change through the app, per entity. A new audited
    // field without a label would be silently hidden from the log.
    const EDITABLE: Record<string, string[]> = {
        person: ['FirstName', 'LastName', 'Sex', 'BirthDate', 'BirthPlace', 'DeathDate', 'DeathPlace', 'DeathCause', 'IsDeceased'],
        family: ['Partner1Id', 'Partner2Id', 'MarriageDate', 'MarriagePlace', 'Type'],
        event: ['Type', 'Date', 'Place', 'Description', 'PersonId', 'FamilyId'],
        source: ['Title', 'Author', 'PublicationInfo', 'RepositoryName', 'CallNumber', 'Text', 'Type', 'Contents', 'Abbreviation'],
        citation: ['Page', 'Quay', 'DataText'],
        case: ['Title', 'Description', 'Status', 'Tags'],
        namevariant: ['Type', 'Name', 'FromDate', 'ToDate', 'IsPrimary'],
        media: ['Title', 'Format', 'FocalX', 'FocalY', 'FocalRadius'],
        mediatag: ['PersonId', 'RegionX', 'RegionY', 'RegionW', 'RegionH'],
        familychild: ['RelationshipType', 'Partner1Relationship', 'Partner2Relationship'],
        // Place geocode, coordinate and hierarchy edits (#924).
        place: ['Name', 'Coordinates', 'DisplayName', 'PinSuppressed', 'PartOf'],
    };

    it('labels every editable field with a key that exists', () => {
        const audit = en.audit as Record<string, string>;
        for (const [entityType, fields] of Object.entries(EDITABLE)) {
            for (const field of fields) {
                const spec = auditFieldSpec(entityType, field);
                expect(spec, `${entityType}.${field}`).not.toBeNull();
                expect(audit[`field_${spec!.label}`], `audit.field_${spec!.label}`).toBeTypeOf('string');
            }
        }
    });

    it('hides internal columns', () => {
        for (const field of ['Id', 'UserId', 'OwnerId', 'TreeId', 'GedcomId', 'FilePath', 'ContentHash', 'ContentType', 'FileSize', 'CreatedAt', 'UpdatedAt', 'RawGedcom', 'HusbandId']) {
            expect(auditFieldSpec('media', field), field).toBeNull();
        }
    });

    it('reads Type by entity', () => {
        expect(auditFieldSpec('family', 'Type')).toEqual({ label: 'family_type', kind: 'familyType' });
        expect(auditFieldSpec('event', 'Type')).toEqual({ label: 'event_type', kind: 'eventType' });
        expect(auditFieldSpec('person', 'Type')).toBeNull();
    });
});

describe('auditRefIds', () => {
    it('collects the person and family ids from diffs and snapshots', () => {
        const ids = auditRefIds([
            { EntityType: 'family', Changes: { fields: { Partner1Id: { old: 812, new: 907 }, MarriagePlace: { old: 'A', new: 'B' } } } },
            { EntityType: 'event', Changes: { snapshot: { Id: 5, PersonId: 3, FamilyId: 9, UserId: 1 } } },
            { EntityType: 'familychild', Changes: { snapshot: { FamilyId: 9, ChildId: 4, TreeId: 1 } } },
        ]);
        expect(ids.people.sort((a, b) => a - b)).toEqual([3, 4, 812, 907]);
        expect(ids.families).toEqual([9]);
    });
});
