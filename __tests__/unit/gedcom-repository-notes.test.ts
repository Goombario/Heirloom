import { describe, it, expect } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { generateGedcom } from '@/lib/gedcom/generator';
import { LINK_OWNER_TABLES, isLinkOwnerTable } from '@/lib/db/fact-tables';

/**
 * ADR 0012 — Repository notes. `REPOSITORY_RECORD +1 <<NOTE_STRUCTURE>>`
 * (ged551-2.txt:227-232) is a standard sub-structure this app dropped entirely on
 * import: the REPO parser handled only NAME/ADDR/CALN, and `Repository` was not in
 * the `NoteLink` owner vocabulary. Repository has no `RawGedcom` passthrough
 * either, so it was unrecoverable loss, not a fidelity gap.
 *
 * The export half is the awkward one and the reason this was scored bigger than
 * ADR 0012's "S": the generator does not read the Repository table at all — it
 * synthesises `0 @Rn@ REPO` records from `Sources.RepositoryName` STRINGS, deduped
 * by name, so there was no `Repository.Id` in scope to hang a note on. It now
 * resolves ids via a name → id map (safe: Repository is unique per (TreeId, Name)).
 */

describe('Repository is a note owner (ADR 0012)', () => {
    it('is in the link-owner vocabulary', () => {
        expect(LINK_OWNER_TABLES.REPOSITORY).toBe('Repository');
    });

    it('validates as a link-owner table', () => {
        expect(isLinkOwnerTable('Repository')).toBe(true);
    });
});

const WITH_INLINE_NOTE = [
    '0 HEAD',
    '0 @S1@ SOUR',
    '1 TITL Parish Register',
    '1 REPO @R1@',
    '0 @R1@ REPO',
    '1 NAME County Archive',
    '1 NOTE Access restricted; microfilm quality poor',
    '0 TRLR',
].join('\n');

describe('Repository notes — import (ADR 0012)', () => {
    it('captures an inline NOTE on the repository record', () => {
        const { repositoryNotes } = parseGedcom(WITH_INLINE_NOTE);
        expect(repositoryNotes).toHaveLength(1);
        expect(repositoryNotes[0].name).toBe('County Archive');
        expect(repositoryNotes[0].notes[0].text).toBe('Access restricted; microfilm quality poor');
    });

    it('resolves a shared NOTE-record pointer on the repository', () => {
        const { repositoryNotes } = parseGedcom([
            '0 HEAD',
            '0 @R1@ REPO',
            '1 NAME County Archive',
            '1 NOTE @N1@',
            '0 @N1@ NOTE Shared research note',
            '0 TRLR',
        ].join('\n'));
        expect(repositoryNotes[0].notes[0].text).toBe('Shared research note');
    });

    it('keeps NAME and ADDR working alongside the new NOTE handling', () => {
        const { sources } = parseGedcom([
            '0 HEAD',
            '0 @S1@ SOUR',
            '1 TITL Parish Register',
            '1 REPO @R1@',
            '0 @R1@ REPO',
            '1 NAME County Archive',
            '1 ADDR 12 High Street',
            '1 NOTE Access restricted',
            '0 TRLR',
        ].join('\n'));
        expect(sources[0].RepositoryName).toBe('County Archive');
        expect(sources[0].RepositoryAddress).toBe('12 High Street');
    });

    it('drops a repository note that resolves to nothing', () => {
        const { repositoryNotes } = parseGedcom([
            '0 HEAD',
            '0 @R1@ REPO',
            '1 NAME County Archive',
            '1 NOTE @NMISSING@',
            '0 TRLR',
        ].join('\n'));
        expect(repositoryNotes.flatMap((r) => r.notes)).toHaveLength(0);
    });

    it('reports no repository notes when the record has none', () => {
        const { repositoryNotes } = parseGedcom([
            '0 HEAD',
            '0 @R1@ REPO',
            '1 NAME County Archive',
            '0 TRLR',
        ].join('\n'));
        expect(repositoryNotes).toHaveLength(0);
    });
});

/** Source + note wiring for one repository, as the export service assembles it. */
const EXPORT_EXTRAS = {
    sources: [{
        Id: 1, Title: 'Parish Register', Author: null, PublicationInfo: null,
        Text: null, Contents: null, Type: null, Num: null,
        RepositoryName: 'County Archive', CallNumber: null,
    }],
    notes: [{ Id: 9, Text: 'Access restricted; microfilm quality poor' }],
    noteLinks: [{ NoteId: 9, OwnerTable: 'Repository', OwnerId: 3 }],
    repoIdByName: new Map([['County Archive', 3]]),
};

describe('Repository notes — export (ADR 0012)', () => {
    it('emits a shared NOTE pointer on the REPO record', () => {
        const out = generateGedcom([], [], undefined, EXPORT_EXTRAS);
        expect(out).toContain('0 @R1@ REPO');
        expect(out).toContain('1 NAME County Archive');
        expect(out).toContain('1 NOTE @N1@');
    });

    it('emits the shared note record itself', () => {
        const out = generateGedcom([], [], undefined, EXPORT_EXTRAS);
        expect(out).toContain('0 @N1@ NOTE Access restricted; microfilm quality poor');
    });

    it('nests the NOTE inside the REPO record, after NAME', () => {
        const lines = generateGedcom([], [], undefined, EXPORT_EXTRAS).split('\n').map((l) => l.trim());
        const repoIdx = lines.indexOf('0 @R1@ REPO');
        const noteIdx = lines.indexOf('1 NOTE @N1@');
        expect(repoIdx).toBeGreaterThan(-1);
        expect(noteIdx).toBeGreaterThan(repoIdx);
        expect(lines.indexOf('1 NAME County Archive')).toBeLessThan(noteIdx);
        // Still inside the REPO record — no intervening level-0 line.
        expect(lines.slice(repoIdx + 1, noteIdx).some((l) => l.startsWith('0 '))).toBe(false);
    });

    it('emits no repository NOTE when the repository has no note link', () => {
        const out = generateGedcom([], [], undefined, { ...EXPORT_EXTRAS, noteLinks: [] });
        expect(out).toContain('0 @R1@ REPO');
        expect(out).not.toContain('1 NOTE @N1@');
    });
});

describe('Repository notes — round trip (ADR 0012)', () => {
    it('survives export → import with its text and repository intact', () => {
        const out = generateGedcom([], [], undefined, EXPORT_EXTRAS);
        const { repositoryNotes } = parseGedcom(out);
        expect(repositoryNotes).toHaveLength(1);
        expect(repositoryNotes[0].name).toBe('County Archive');
        expect(repositoryNotes[0].notes[0].text).toBe('Access restricted; microfilm quality poor');
    });

    it('is idempotent across a second round trip', () => {
        const first = parseGedcom(WITH_INLINE_NOTE).repositoryNotes;
        const out = generateGedcom([], [], undefined, EXPORT_EXTRAS);
        const second = parseGedcom(out).repositoryNotes;
        expect(second[0].notes[0].text).toBe(first[0].notes[0].text);
    });
});

describe('Repository notes — repository with no referencing source (ADR 0013)', () => {
    // The importer deliberately creates a repository for a note-bearing REPO record
    // that no source references, rather than dropping the note. Export has to be
    // able to round that back out, or the note becomes an orphan NOTE record with
    // nothing pointing at it and is dropped on the next import.
    const ORPHAN_EXTRAS = {
        notes: [{ Id: 9, Text: 'Access restricted' }],
        noteLinks: [{ NoteId: 9, OwnerTable: 'Repository', OwnerId: 3 }],
        repoIdByName: new Map([['County Archive', 3]]),
    };

    it('still emits the REPO record and its note pointer', () => {
        const out = generateGedcom([], [], undefined, ORPHAN_EXTRAS);
        expect(out).toContain('0 @R1@ REPO');
        expect(out).toContain('1 NAME County Archive');
        expect(out).toContain('1 NOTE @N1@');
    });

    it('round-trips that note back to the same repository', () => {
        const { repositoryNotes } = parseGedcom(generateGedcom([], [], undefined, ORPHAN_EXTRAS));
        expect(repositoryNotes).toHaveLength(1);
        expect(repositoryNotes[0].name).toBe('County Archive');
        expect(repositoryNotes[0].notes[0].text).toBe('Access restricted');
    });

    it('emits a REPO record for a repository no source cites (#966)', () => {
        const out = generateGedcom([], [], undefined, {
            notes: [], noteLinks: [], repoIdByName: new Map([['Unused Archive', 4]]),
        });
        expect(out).toContain('0 @R1@ REPO\n1 NAME Unused Archive');
    });
});
