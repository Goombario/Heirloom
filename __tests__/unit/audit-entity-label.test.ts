import { describe, it, expect, vi } from 'vitest';
import { buildEntityLabel, resolveEntityLabel } from '@/lib/db/queries/audit-capture';

/**
 * Audit labels used to read "ADOP for Person #20371" — a GEDCOM code and a row
 * id, which is the file format's vocabulary, not a person's.
 *
 * Labels are fixed at CAPTURE time only (spec §12.2.4): the log is a historical
 * record and is not rewritten, so these cover what a NEW entry gets, not what
 * existing rows say.
 */
describe('buildEntityLabel — event', () => {
    it('maps the GEDCOM code to its display name', () => {
        expect(buildEntityLabel('event', { Id: 1, Type: 'ADOP', PersonId: 20371 }))
            .toBe('Adoption for Person #20371');
    });

    it('leaves an unrecognised code as-is rather than inventing a name', () => {
        expect(buildEntityLabel('event', { Id: 1, Type: 'ZZZZ', PersonId: 5 }))
            .toBe('ZZZZ for Person #5');
    });

    it('falls back to a generic event when no type is recorded', () => {
        expect(buildEntityLabel('event', { Id: 9 })).toBe('Event #9');
    });
});

describe('resolveEntityLabel', () => {
    const execWith = (rows: unknown[]) => ({ query: vi.fn().mockResolvedValue({ rows }) });

    it('names the person an event belongs to', async () => {
        const exec = execWith([{ name: 'Cecilia Rose Anderson' }]);
        await expect(resolveEntityLabel('event', { Id: 1, Type: 'ADOP', PersonId: 20371, TreeId: 1 }, exec))
            .resolves.toBe('Adoption — Cecilia Rose Anderson');
    });

    it('names both partners of a family event', async () => {
        const exec = execWith([{ p1: 'Tobias Wren', p2: 'Elspeth Harrow' }]);
        await expect(resolveEntityLabel('event', { Id: 1, Type: 'MARR', FamilyId: 42, TreeId: 1 }, exec))
            .resolves.toBe('MARR — Tobias Wren & Elspeth Harrow');
    });

    it('falls back to the id form when the subject has no recorded name', async () => {
        const exec = execWith([{ name: '' }]);
        await expect(resolveEntityLabel('event', { Id: 1, Type: 'RESI', PersonId: 7, TreeId: 1 }, exec))
            .resolves.toBe('Residence for Person #7');
    });

    it('falls back rather than throwing when the lookup fails — an audit label is never worth failing a write over', async () => {
        const exec = { query: vi.fn().mockRejectedValue(new Error('connection lost')) };
        await expect(resolveEntityLabel('event', { Id: 1, Type: 'BIRT', PersonId: 3, TreeId: 1 }, exec))
            .resolves.toBe('Birth for Person #3');
    });

    it('names a citation by its subject and fact, never its storage coordinates (#701)', async () => {
        const exec = execWith([{ name: 'Aster Arbor' }]);
        await expect(resolveEntityLabel('citation', { Id: 3, FactTable: 'PersonBirth', FactId: 7, TreeId: 1 }, exec))
            .resolves.toBe('Citation — Aster Arbor · birth');
    });

    it('names a family citation by both partners', async () => {
        const exec = execWith([{ p1: 'John Marsh', p2: 'Mary Marsh' }]);
        await expect(resolveEntityLabel('citation', { Id: 3, FactTable: 'Families', FactId: 1, TreeId: 1 }, exec))
            .resolves.toBe('Citation — John Marsh & Mary Marsh · partnership');
    });

    it('names an event citation by the event type and its subject', async () => {
        const exec = {
            query: vi.fn()
                .mockResolvedValueOnce({ rows: [{ Type: 'ADOP', PersonId: 4, FamilyId: null }] })
                .mockResolvedValueOnce({ rows: [{ name: 'Aster Arbor' }] }),
        };
        await expect(resolveEntityLabel('citation', { Id: 3, FactTable: 'Events', FactId: 12, TreeId: 1 }, exec))
            .resolves.toBe('Citation — Aster Arbor · adoption');
    });

    it('falls back to the fact kind alone when the subject is gone', async () => {
        const exec = execWith([]);
        await expect(resolveEntityLabel('citation', { Id: 3, FactTable: 'PersonDeath', FactId: 99, TreeId: 1 }, exec))
            .resolves.toBe('Citation — death');
    });

    it('does not query when the record has no tree (#847)', async () => {
        const exec = execWith([{ name: 'Someone Else' }]);
        await expect(resolveEntityLabel('event', { Id: 1, Type: 'BIRT', PersonId: 3 }, exec))
            .resolves.toBe('Birth for Person #3');
        expect(exec.query).not.toHaveBeenCalled();
    });

    it('does not query for non-event entities', async () => {
        const exec = execWith([{ name: 'unused' }]);
        await expect(resolveEntityLabel('person', { Id: 5, FirstName: 'Ada', LastName: 'Tester' }, exec))
            .resolves.toBe('Ada Tester');
        expect(exec.query).not.toHaveBeenCalled();
    });
});
