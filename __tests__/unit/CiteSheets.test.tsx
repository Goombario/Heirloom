/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';
import type { Citation } from '@/lib/db/queries/citations';
import type { CitationFactDescriptor } from '@/app/components/citations/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 7 }) }));
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ redirectIfUnauthorized: () => false }) }));
vi.mock('@/app/components/RepositoryPicker', () => ({ RepositoryPicker: () => <div data-testid="repo-picker" /> }));
vi.mock('@/app/components/research/SearchRecordsPanel', () => ({ SearchRecordsPanel: () => <div data-testid="search-records" /> }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/app/components/ui/Toast', () => ({
  showChangeToast: toast, showErrorToast: vi.fn(), showSuccessToast: vi.fn(), showInfoToast: vi.fn(), AppToaster: () => null,
}));
const client = vi.hoisted(() => ({
  sources: { list: vi.fn(), search: vi.fn(), listRecentlyCited: vi.fn(), create: vi.fn() },
  citations: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  audit: { revert: vi.fn() },
}));
vi.mock('@/lib/data', () => ({ getDataClient: async () => client }));

import { CiteSheets, type CiteSheetTarget } from '@/app/components/citations/CiteSheets';

const citation = {
  Id: 11, SourceId: 3, FactTable: 'PersonBirth', FactId: 1, Page: 'entry 61', Quay: '3', DataText: null, Url: null,
  sourceTitle: 'Parish register', sourceType: 'Church', sourceRepo: 'County archive',
} as unknown as Citation;
const fact: CitationFactDescriptor = { factTable: 'PersonBirth' as CitationFactDescriptor['factTable'], factId: 1, label: 'Birth', value: '1871', citations: [citation] };
const sources = [
  { Id: 3, Title: 'Parish register', Type: 'Church', Author: null, RepositoryName: 'County archive' },
  { Id: 4, Title: 'City directory', Type: 'Document', Author: null, RepositoryName: null },
];

function renderSheets(target: CiteSheetTarget, over: Partial<React.ComponentProps<typeof CiteSheets>> = {}) {
  const props = { subject: 'Greta', sourceNumbers: new Map([[3, 1]]), canCite: true, canDelete: true, research: null, onClose: vi.fn(), onChanged: vi.fn(), ...over };
  render(<CiteSheets target={target} {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  client.sources.list.mockResolvedValue({ sources, count: 2 });
  client.sources.listRecentlyCited.mockResolvedValue([sources[0]]);
  client.sources.search.mockResolvedValue([sources[1]]);
  client.citations.create.mockResolvedValue({ Id: 12, auditIds: [90] });
  client.citations.update.mockResolvedValue({ Id: 11, auditIds: [91] });
  client.citations.remove.mockResolvedValue({ auditIds: [92] });
  client.sources.create.mockResolvedValue({ Id: 5 });
});

describe('CiteSheets (#1049)', () => {
  it('opens a pin on its citation, with Open source, Edit citation and Cite another source', () => {
    renderSheets({ fact, start: 'view', citationId: 11 });
    expect(screen.getByText('Parish register')).toBeInTheDocument();
    expect(screen.getByText('entry 61')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'open_source' })).toHaveAttribute('href', '/library?tab=sources&source=3');
    expect(screen.getByRole('button', { name: 'edit_citation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'cite_another' })).toBeInTheDocument();
  });

  it('shows a viewer the citation without the Edit and Cite rows', () => {
    renderSheets({ fact, start: 'view', citationId: 11 }, { canCite: false, canDelete: false });
    expect(screen.getByRole('link', { name: 'open_source' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'edit_citation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'cite_another' })).toBeNull();
  });

  it('picks a source, then attaches it with the page and certainty, offering Undo', async () => {
    const user = userEvent.setup();
    const props = renderSheets({ fact, start: 'pick' });
    expect(await screen.findByText('recently_cited')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /City directory/ }));
    // Attach is live before anything is typed: every detail is optional.
    const attach = screen.getByRole('button', { name: 'attach' });
    expect(attach).toBeEnabled();
    await user.type(screen.getByPlaceholderText('page_ph'), 'p. 4');
    await user.click(screen.getByRole('button', { name: 'certainty_short_2' }));
    await user.click(attach);
    await waitFor(() => expect(client.citations.create).toHaveBeenCalledWith(
      { FactTable: 'PersonBirth', FactId: 1, SourceId: 4, Page: 'p. 4', Quay: '2', DataText: null, Url: null }, 7));
    expect(props.onChanged).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'toast_cited', onUndo: expect.any(Function) }));
  });

  it('creates a new source from the search text and cites it', async () => {
    const user = userEvent.setup();
    renderSheets({ fact, start: 'pick' });
    await user.type(screen.getByRole('searchbox'), 'Duluth directory');
    await user.click(screen.getByRole('button', { name: 'create_named:Duluth directory' }));
    expect(screen.getByLabelText('field_title_label')).toHaveValue('Duluth directory');
    await user.click(screen.getByRole('button', { name: 'type_Census' }));
    await user.click(screen.getByRole('button', { name: 'next' }));
    await user.click(screen.getByRole('button', { name: 'attach' }));
    await waitFor(() => expect(client.citations.create).toHaveBeenCalledWith(expect.objectContaining({ SourceId: 5 }), 7));
    expect(client.sources.create).toHaveBeenCalledWith(expect.objectContaining({ Title: 'Duluth directory', Type: 'Census' }), 7);
  });

  it('hands the citation back without writing it for a fact that has no row yet (#1066)', async () => {
    const user = userEvent.setup();
    const onPending = vi.fn();
    const props = renderSheets({ fact: { ...fact, factId: 0, citations: [] }, start: 'pick' }, { onPending });
    await user.click(await screen.findByRole('button', { name: /City directory/ }));
    await user.type(screen.getByPlaceholderText('page_ph'), 'p. 4');
    await user.click(screen.getByRole('button', { name: 'attach' }));
    expect(onPending).toHaveBeenCalledWith(expect.objectContaining({ factTable: 'PersonBirth', factLabel: 'Birth', page: 'p. 4', sourceId: 4 }));
    expect(client.citations.create).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('holds a new source for a fact with no row yet, creating nothing (#1066)', async () => {
    const user = userEvent.setup();
    const onPending = vi.fn();
    renderSheets({ fact: { ...fact, factId: 0, citations: [] }, start: 'pick' }, { onPending });
    await user.type(screen.getByRole('searchbox'), 'Duluth directory');
    await user.click(screen.getByRole('button', { name: 'create_named:Duluth directory' }));
    await user.click(screen.getByRole('button', { name: 'next' }));
    await user.click(screen.getByRole('button', { name: 'attach' }));
    expect(onPending).toHaveBeenLastCalledWith(expect.objectContaining({ newSource: expect.objectContaining({ Title: 'Duluth directory' }) }));
    expect(client.sources.create).not.toHaveBeenCalled();
  });

  it('hands a citation for an unsaved fact back instead of writing it (#1065)', async () => {
    const user = userEvent.setup();
    const onPending = vi.fn();
    const props = renderSheets({ fact: { ...fact, factId: -1, citations: [] }, start: 'pick' }, { onPending, canDelete: false });
    await user.click(await screen.findByRole('button', { name: /City directory/ }));
    await user.type(screen.getByPlaceholderText('page_ph'), 'p. 4');
    await user.click(screen.getByRole('button', { name: 'attach' }));
    expect(onPending).toHaveBeenCalledWith(expect.objectContaining({ factTable: 'PersonBirth', sourceId: 4, page: 'p. 4' }));
    expect(client.citations.create).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('stages a new source with its citation when the fact is unsaved', async () => {
    const user = userEvent.setup();
    const onPending = vi.fn();
    renderSheets({ fact: { ...fact, factId: -1, citations: [] }, start: 'pick' }, { onPending });
    await user.type(screen.getByRole('searchbox'), 'Duluth directory');
    await user.click(screen.getByRole('button', { name: 'create_named:Duluth directory' }));
    await user.click(screen.getByRole('button', { name: 'next' }));
    await user.click(screen.getByRole('button', { name: 'attach' }));
    expect(onPending).toHaveBeenCalledWith(expect.objectContaining({ newSource: expect.objectContaining({ Title: 'Duluth directory' }) }));
    expect(client.sources.create).not.toHaveBeenCalled();
  });

  it('edits a citation: Save waits for a change, and contributors get no Undo or remove row', async () => {
    const user = userEvent.setup();
    renderSheets({ fact, start: 'edit', citationId: 11 }, { canDelete: false });
    expect(screen.getByPlaceholderText('page_ph')).toHaveValue('entry 61');
    const save = screen.getByRole('button', { name: 'save' });
    expect(save).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'remove' })).toBeNull();
    await user.type(screen.getByPlaceholderText('page_ph'), ', line 2');
    await user.click(save);
    await waitFor(() => expect(client.citations.update).toHaveBeenCalledWith(11, expect.objectContaining({ Page: 'entry 61, line 2', Quay: '3' }), 7));
    expect(toast).toHaveBeenCalledWith({ message: 'toast_updated', onUndo: undefined });
  });

  it('asks once before removing a citation, then offers Undo', async () => {
    const user = userEvent.setup();
    const props = renderSheets({ fact, start: 'edit', citationId: 11 });
    await user.click(screen.getByRole('button', { name: 'remove' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'keep' }));
    expect(client.citations.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'remove' }));
    await user.click(screen.getByRole('button', { name: 'remove_confirm' }));
    await waitFor(() => expect(client.citations.remove).toHaveBeenCalledWith(11, 7));
    expect(props.onClose).toHaveBeenCalled();
    const { onUndo } = toast.mock.calls[0][0];
    onUndo();
    await waitFor(() => expect(client.audit.revert).toHaveBeenCalledWith([92], 7));
  });
});
