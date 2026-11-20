/** @vitest-environment happy-dom */

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import type { PersonWithRelations } from '@/lib/db/schema';
import type { Note } from '@/lib/data/types';
import type { CitationFactDescriptor } from '@/app/components/citations/types';
import { NotesSection } from '@/app/people/view/desktop/NotesSection';
import { SourcesSection } from '@/app/people/view/desktop/SourcesSection';
import { dataCache } from '@/lib/data/cache';
import { notesKey } from '@/app/components/notes/ownerNotesCache';

const note = (Id: number, Text: string, extra: Partial<Note> = {}): Note =>
  ({ Id, Text, OwnerId: 1, GedcomXref: null, BackfilledFromPersonId: null, CreatedAt: '', IsPrimary: 0, OwnerFact: null, AddedInApp: 1, ...extra });

const peopleNotes = [
  note(1, 'She kept the farm accounts.', { IsPrimary: 1 }),
  note(2, 'Ask aunt Maj about the photo.'),
  note(3, 'Born during the great frost.', { OwnerFact: 'Birth' }),
];
const censusNotes = [note(4, 'Listed as a servant.')];
const listForOwner = vi.fn(async (table: string, _id?: number) => (table === 'People' ? peopleNotes : censusNotes));
const move = vi.fn(async () => ({ auditIds: [21, 22] }));
const update = vi.fn(async () => ({ auditIds: [20] }));
vi.mock('@/lib/data', () => ({ getDataClient: async () => ({ notes: { listForOwner, move, update } }) }));
vi.mock('@/app/components/GuardedLink', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const anna = {
  Id: 10, FirstName: 'Anna', LastName: 'Lind', Sex: 'F', BirthDate: '3 MAR 1868', DeathDate: null,
  events: [{ Id: 50, Type: 'CENS', Date: '1880', PersonId: 10, noteCount: 1 }],
  parents: [], spouses: [],
} as unknown as PersonWithRelations;

const wrap = (ui: ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('desktop person Notes (#49)', () => {
  const section = (run = vi.fn(async (w: () => Promise<unknown>) => { await w(); return true; })) => {
    wrap(<NotesSection person={anna} treeId={1} canEdit canDelete run={run} refreshKey={0} onNotesChange={() => {}} onEditBiography={() => {}} />);
    return run;
  };

  it('lists every note labelled by what it is about', async () => {
    section();
    await screen.findByText('Listed as a servant.');
    const labels = screen.getAllByRole('listitem').map((li) => li.querySelector('.note-list__label')?.textContent);
    expect(labels).toEqual(['Biography', 'About Anna', 'Birth · 1868', 'Census · 1880']);
  });

  it('moves a note with its About select', async () => {
    const run = section();
    fireEvent.click(await screen.findByRole('button', { name: /Edit note: Ask aunt Maj/ }));
    const panel = screen.getByRole('group', { name: 'Edit note' });
    fireEvent.click(within(panel).getByRole('combobox', { name: 'About' }));
    fireEvent.click(screen.getByRole('option', { name: 'Census · 1880' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(update).not.toHaveBeenCalled();
    expect(move).toHaveBeenCalledWith(2,
      { ownerTable: 'People', ownerId: 10, ownerFact: null },
      { ownerTable: 'Events', ownerId: 50, ownerFact: null }, 1);
  });

  it('paints notes a hover prefetch already loaded, before any fetch (#65)', () => {
    dataCache.set(notesKey(1, 'People', 10), peopleNotes);
    dataCache.set(notesKey(1, 'Events', 50), censusNotes);
    section();
    // Synchronous: no findBy, so the rows came from the cache on first render.
    expect(screen.getByText('Listed as a servant.')).toBeInTheDocument();
    expect(screen.getByText('Ask aunt Maj about the photo.')).toBeInTheDocument();
    dataCache.clear();
  });

  it('puts Add note on the heading, not under the list (#157)', async () => {
    section();
    await screen.findByText('Listed as a servant.');
    const heading = screen.getByRole('heading', { name: /Notes/ }).closest('.section-label');
    expect(heading).toContainElement(screen.getByRole('button', { name: 'Add note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(screen.getByRole('group', { name: 'New note' })).toBeInTheDocument();
    expect(heading?.querySelector('.section-add')).toBeNull();
  });

  it('is one line, "None yet" with its Add, when the person has no notes (#157)', async () => {
    listForOwner.mockImplementation(async () => []);
    const empty = vi.fn();
    const bare = { ...anna, events: [] } as unknown as PersonWithRelations;
    wrap(<NotesSection person={bare} treeId={1} canEdit canDelete run={vi.fn()} refreshKey={0} onNotesChange={() => {}} onEmptyChange={empty} onEditBiography={() => {}} />);
    await screen.findByText('None yet');
    expect(document.querySelector('section#notes')).toHaveClass('is-empty');
    expect(empty).toHaveBeenLastCalledWith(true);
    // Adding switches the section back to its normal layout.
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(document.querySelector('section#notes')).not.toHaveClass('is-empty');
    expect(screen.getByRole('group', { name: 'New note' })).toBeInTheDocument();
    listForOwner.mockImplementation(async (table: string) => (table === 'People' ? peopleNotes : censusNotes));
  });
});

// The source opens over the page; its own loading is SourceModal's concern.
vi.mock('@/app/library/SourceModal', () => ({
  default: ({ sourceId, onClose }: { sourceId: number; onClose: () => void }) => (
    <div role="dialog" aria-label={`Source ${sourceId}`}><button type="button" onClick={onClose}>Close</button></div>
  ),
}));

describe('desktop Sources cited (#49, ADR 0044)', () => {
  const sectionProps = { treeId: 1, canEdit: true, canDelete: true, onChanged: () => {} };
  const cite = (SourceId: number, sourceTitle: string) => ({ SourceId, sourceTitle, sourceType: 'Census' }) as unknown as CitationFactDescriptor['citations'][number];
  const fact = (factId: number, label: string, date: string | undefined, citations: CitationFactDescriptor['citations']): CitationFactDescriptor =>
    ({ factTable: 'Events', factId, label, value: '', date, citations } as unknown as CitationFactDescriptor);

  it('names the facts each source is cited for, three then a count', () => {
    const c = [cite(7, '1880 census')];
    wrap(<SourcesSection title="Sources cited" {...sectionProps} facts={[
      fact(1, 'Birth', '3 Mar 1868', c), fact(2, 'Census', '1880', c), fact(3, 'Residence', '1885', c), fact(4, 'Census', '1890', c),
    ]} />);
    expect(screen.getByRole('button', { name: /1880 census/ })).toHaveTextContent('Census · Cited for Birth 1868, Census 1880, Residence 1885 and 1 more');
  });

  it('opens the source over the page instead of leaving for the Library', () => {
    wrap(<SourcesSection title="Sources cited" {...sectionProps} facts={[fact(1, 'Birth', '1868', [cite(7, '1880 census')])]} />);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /1880 census/ }));
    expect(screen.getByRole('dialog', { name: 'Source 7' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is one line with no Add when nothing is cited (#157)', () => {
    wrap(<SourcesSection title="Sources cited" {...sectionProps} facts={[]} />);
    expect(document.querySelector('section#sources')).toHaveClass('is-empty');
    expect(screen.getByText(en.personDesktop.sources_none)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
