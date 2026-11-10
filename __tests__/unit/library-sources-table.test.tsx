/** @vitest-environment happy-dom */

import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, unknown>) => ({
    col_title: 'Title', col_type: 'Type', col_repository: 'Repository', col_cited_by: 'Cited by', col_citations: 'Citations',
    uncited_mark: 'Uncited', type_Census: 'Census', type_Oral: 'Oral', type_Vital: 'Vital',
    citation_count: `${values?.count} citations`, untitled_source: 'Untitled source',
  }[key] ?? key),
}));
vi.mock('@/app/components/PersonAvatar', () => ({ default: ({ name }: { name: string }) => <span>{name}</span> }));

import SourcesTable from '@/app/library/sections/SourcesTable';
import type { SourceWithCitationCount } from '@/lib/db/queries/sources';

function source(Id: number, Title: string, overrides: Partial<SourceWithCitationCount> = {}): SourceWithCitationCount {
  return {
    Id, OwnerId: 1, Title, Author: null, PublicationInfo: null, RepositoryName: null, CallNumber: null, Text: null,
    Type: 'Census', Contents: null, Num: null, citationCount: 1, citedByPeople: [], ...overrides,
  };
}

const SOURCES = [
  source(1, 'Wedding notice', { Type: 'Vital', RepositoryName: 'Toronto Library', citationCount: 2 }),
  source(2, 'Aunt Ruth on the farm', { Type: 'Oral', Author: 'Ruth Ellis', citationCount: 5 }),
  source(3, '1901 Census', { RepositoryName: 'Archives Canada', CallNumber: 'District 118', citationCount: 0 }),
];

const titles = () => screen.getAllByRole('row').slice(1).map((row) => row.querySelector('.serif')?.textContent);

describe('SourcesTable (#1153)', () => {
  it('sorts by title to start, and every column but Cited by sorts', () => {
    render(<SourcesTable sources={SOURCES} treeId={7} onOpen={vi.fn()} />);
    expect(titles()).toEqual(['1901 Census', 'Aunt Ruth on the farm', 'Wedding notice']);
    expect(screen.getByRole('columnheader', { name: /Title/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: 'Cited by' })).not.toHaveAttribute('tabindex');

    fireEvent.click(screen.getByRole('columnheader', { name: /Title/ }));
    expect(titles()).toEqual(['Wedding notice', 'Aunt Ruth on the farm', '1901 Census']);

    fireEvent.click(screen.getByRole('columnheader', { name: /Citations/ }));
    expect(titles()).toEqual(['1901 Census', 'Wedding notice', 'Aunt Ruth on the farm']);

    fireEvent.click(screen.getByRole('columnheader', { name: /Type/ }));
    expect(titles()).toEqual(['1901 Census', 'Aunt Ruth on the farm', 'Wedding notice']);
  });

  it('keeps sources with no repository last whichever way Repository sorts', () => {
    render(<SourcesTable sources={SOURCES} treeId={7} onOpen={vi.fn()} />);
    const repository = screen.getByRole('columnheader', { name: /Repository/ });

    fireEvent.click(repository);
    expect(titles()).toEqual(['1901 Census', 'Wedding notice', 'Aunt Ruth on the farm']);
    fireEvent.click(repository);
    expect(titles()).toEqual(['Wedding notice', '1901 Census', 'Aunt Ruth on the farm']);
  });

  it('drops Type and Cited by below lg (tablet)', () => {
    render(<SourcesTable sources={SOURCES} treeId={7} onOpen={vi.fn()} />);
    for (const name of [/Type/, 'Cited by']) {
      expect(screen.getByRole('columnheader', { name })).toHaveClass('hidden', 'lg:table-cell');
    }
    expect(screen.getByRole('columnheader', { name: /Repository/ })).not.toHaveClass('hidden');
    expect(screen.getByRole('columnheader', { name: /Citations/ })).not.toHaveClass('hidden');
  });

  it('marks uncited rows, names the author of an oral source like any other, and opens a source from its row', () => {
    const onOpen = vi.fn();
    render(<SourcesTable sources={SOURCES} treeId={7} onOpen={onOpen} />);

    expect(screen.getByText('Uncited')).toHaveClass('text-evidence');
    expect(screen.getByText('Ruth Ellis')).toBeInTheDocument();
    expect(screen.getByText('District 118')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Wedding notice/ }));
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('shows up to four citing people as portraits', () => {
    const people = [1, 2, 3, 4].map((Id) => ({ Id, FirstName: `P${Id}`, LastName: 'Ellis', EffectiveFirstName: null, Nickname: null, Sex: 'F', PrimaryMediaId: null }));
    render(<SourcesTable sources={[source(9, 'Census', { citedByPeople: people, citationCount: 6 })]} treeId={7} onOpen={vi.fn()} />);
    const stack = screen.getByRole('group', { name: 'P1 Ellis, P2 Ellis, P3 Ellis, P4 Ellis' });
    expect(stack.children).toHaveLength(4);
  });

  it('leaves out the Repository column when a repository is picked', () => {
    render(<SourcesTable sources={SOURCES} treeId={7} onOpen={vi.fn()} hideRepository />);
    expect(screen.queryByRole('columnheader', { name: /Repository/ })).not.toBeInTheDocument();
  });
});
