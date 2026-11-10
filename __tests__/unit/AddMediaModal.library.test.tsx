/** @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaWithPerson } from '@/lib/db/schema';

const listMedia = vi.hoisted(() => vi.fn());
const listForOwner = vi.hoisted(() => vi.fn());
const linkToOwner = vi.hoisted(() => vi.fn());
const upload = vi.hoisted(() => vi.fn());
const redirectIfUnauthorized = vi.hoisted(() => vi.fn().mockReturnValue(false));
const reportError = vi.hoisted(() => vi.fn());

vi.mock('next-intl', () => {
  const t = (key: string, values?: Record<string, unknown>) => (values && 'name' in values ? `${key}:${values.name as string}` : key);
  (t as unknown as { rich: (key: string) => string }).rich = (key: string) => key;
  return { useLocale: () => 'en', useTranslations: () => t };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/data', () => {
  const client = () => ({
    media: { list: listMedia, listForOwner, linkToOwner, upload, findDuplicates: vi.fn().mockResolvedValue([]) },
  });
  return {
    getDataClient: async () => client(),
    withWriteBatch: (run: (c: ReturnType<typeof client>) => Promise<unknown>) => run(client()),
  };
});
vi.mock('@/app/components/useErrorToast', () => ({
  useErrorToast: () => ({ reportError, redirectIfUnauthorized }),
}));
vi.mock('@/app/components/Modal', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/app/components/MediaImg', () => ({ default: ({ alt }: { alt: string }) => <span>{alt}</span> }));

import AddMediaModal from '@/app/components/media/AddMediaModal';
import type { MediaPickerSource } from '@/app/components/media/add-media/library';

const library = [
  { Id: 1, Title: 'Already attached' },
  { Id: 2, Title: 'Farm', TaggedPersonIds: [], TaggedPersonNames: [] },
  { Id: 3, Title: 'Wedding, 1882', TaggedPersonIds: [11], TaggedPersonNames: ['Hazel Bracken'] },
  { Id: 4, Title: '1901 census', ContentType: 'application/pdf', LinkedPersonNames: [], LinkCount: 0 },
] as unknown as MediaWithPerson[];

function family(extra: Partial<React.ComponentProps<typeof AddMediaModal>> = {}) {
  return <AddMediaModal target={{ kind: 'owner', ownerTable: 'Families', ownerId: 4 }} treeId={9} targetName="Hazel and Tom" relevantPersonIds={[11]} onClose={vi.fn()} onAdded={vi.fn()} {...extra} />;
}

describe('AddMediaModal: the library (#1204)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMedia.mockResolvedValue({ media: library });
    listForOwner.mockResolvedValue([{ Id: 1 }]);
    linkToOwner.mockResolvedValue(undefined);
  });

  it('lists tagged media first, leaves out what is attached, and links the picks on Add', async () => {
    const onAdded = vi.fn();
    const onMediaChanged = vi.fn();
    render(family({ onAdded, onMediaChanged }));

    const tagged = await screen.findByRole('region', { name: 'section_tagged:Hazel and Tom' });
    expect(tagged).toHaveTextContent('Wedding, 1882');
    expect(screen.getByRole('region', { name: 'section_rest' })).toHaveTextContent('Farm');
    expect(screen.queryByTitle('Already attached')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'add_n' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Farm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wedding, 1882' }));
    expect(screen.getByRole('button', { name: 'Farm' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'add_n' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(linkToOwner).toHaveBeenCalledWith(2, 'Families', 4, 9, undefined);
    expect(linkToOwner).toHaveBeenCalledWith(3, 'Families', 4, 9, undefined);
    expect(upload).not.toHaveBeenCalled();
    expect(onMediaChanged).toHaveBeenCalledOnce();
  });

  it('does not expose pickable candidates until the attached-media read succeeds', async () => {
    listForOwner.mockReset();
    listForOwner.mockRejectedValueOnce(new Error('private attached lookup failure'));
    render(family());

    expect(await screen.findByRole('alert')).toHaveTextContent('error_generic');
    expect(screen.queryByTitle('Farm')).not.toBeInTheDocument();

    listForOwner.mockResolvedValueOnce([{ Id: 1 }]);
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByTitle('Farm')).toBeInTheDocument());
    expect(screen.queryByTitle('Already attached')).not.toBeInTheDocument();
    expect(linkToOwner).not.toHaveBeenCalled();
  });

  it('filters by kind and search, and the no-match state offers only Clear search', async () => {
    render(family());
    await screen.findByTitle('Farm');

    fireEvent.click(screen.getByRole('radio', { name: 'kind_documents' }));
    expect(screen.getByTitle('1901 census')).toBeInTheDocument();
    expect(screen.queryByTitle('Farm')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'kind_all' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'hazel' } });
    expect(screen.getByRole('region', { name: 'section_matches' })).toHaveTextContent('Wedding, 1882');
    expect(screen.queryByTitle('Farm')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('no_match_title')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'clear_search' }));
    expect(screen.getByTitle('Farm')).toBeInTheDocument();
  });

  it('shows the empty library with no search', async () => {
    listMedia.mockResolvedValue({ media: [] });
    render(family());
    expect(await screen.findByText('empty_library')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByText('drop_to_family')).toBeInTheDocument();
  });

  it('hands an unsaved event its picks without writing anything', async () => {
    const onStage = vi.fn();
    const onClose = vi.fn();
    render(<AddMediaModal target={{ kind: 'owner', ownerTable: 'Events' }} treeId={9} onStage={onStage} stagedMediaIds={[3]} onClose={onClose} onAdded={vi.fn()} />);
    await screen.findByTitle('Farm');
    expect(screen.queryByTitle('Wedding, 1882')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Farm' }));
    fireEvent.click(screen.getByRole('button', { name: 'add_n' }));
    expect(onStage).toHaveBeenCalledWith({ files: [], mediaIds: [2] });
    expect(onClose).toHaveBeenCalled();
    expect(linkToOwner).not.toHaveBeenCalled();
    expect(listForOwner).not.toHaveBeenCalled();
  });
});

const caseMedia = [
  { Id: 5, Title: 'Wedding portrait', PersonFirstName: 'Hazel', PersonLastName: 'Bracken' },
  { Id: 6, Title: 'Ship manifest', PersonFirstName: 'Tom', PersonLastName: 'Weller' },
] as unknown as MediaWithPerson[];

function source(overrides: Partial<MediaPickerSource> = {}): MediaPickerSource {
  return {
    key: 'case:3',
    loadCandidates: vi.fn().mockResolvedValue(caseMedia),
    attach: vi.fn().mockResolvedValue(undefined),
    emptyLabel: 'Nothing on this case',
    sectionTitle: 'Media of the case people',
    ...overrides,
  };
}

// #926: a case feeds Add media its own candidates and attach.
describe('AddMediaModal with a case source', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the source\'s candidates, searchable by person, and attaches the picks in one call', async () => {
    const src = source();
    const onAdded = vi.fn();
    render(<AddMediaModal target={{ kind: 'case', caseId: 3, source: src }} treeId={9} onClose={vi.fn()} onAdded={onAdded} />);

    expect(await screen.findByRole('region', { name: 'Media of the case people' })).toBeInTheDocument();
    expect(screen.getAllByText(/Hazel Bracken/).length).toBeGreaterThan(0);
    expect(listMedia).not.toHaveBeenCalled();
    expect(listForOwner).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'weller' } });
    expect(screen.queryByTitle('Wedding portrait')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ship manifest' }));
    fireEvent.click(screen.getByRole('button', { name: 'add_n' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(src.attach).toHaveBeenCalledWith([6]);
    expect(linkToOwner).not.toHaveBeenCalled();
  });

  it('shows an attach failure in the dialog and keeps the selection', async () => {
    const src = source({ attach: vi.fn().mockRejectedValue(new Error('closed case')) });
    const onAdded = vi.fn();
    render(<AddMediaModal target={{ kind: 'case', caseId: 3, source: src }} treeId={9} onClose={vi.fn()} onAdded={onAdded} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Wedding portrait' }));
    fireEvent.click(screen.getByRole('button', { name: 'add_n' }));

    expect(await screen.findByText('batch_stopped')).toBeInTheDocument();
    expect(onAdded).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Wedding portrait' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses the source\'s empty label', async () => {
    render(<AddMediaModal target={{ kind: 'case', caseId: 3, source: source({ loadCandidates: vi.fn().mockResolvedValue([]) }) }} treeId={9} onClose={vi.fn()} onAdded={vi.fn()} />);
    expect(await screen.findByText('Nothing on this case')).toBeInTheDocument();
  });
});
