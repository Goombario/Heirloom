import { describe, expect, it, vi } from 'vitest';
import { attachPendingCommentCitation } from '@/app/cases/view/commentCitation';

describe('case comment pending citations', () => {
  it('preserves evidence fields for an existing source', async () => {
    const createCitation = vi.fn().mockResolvedValue({});
    const client = { sources: { create: vi.fn() }, citations: { create: createCitation } } as never;

    await attachPendingCommentCitation(client, {
      factTable: 'CaseComments', factLabel: 'Entry', sourceId: 12, sourceTitle: 'Register',
      page: 'folio 4', quay: '3', dataText: 'The exact entry', url: 'https://records.example.org/entry/4',
    }, 44, 9);

    expect(createCitation).toHaveBeenCalledWith({
      FactTable: 'CaseComments', FactId: 44, SourceId: 12,
      Page: 'folio 4', Quay: '3', DataText: 'The exact entry', Url: 'https://records.example.org/entry/4',
    }, 9);
  });

  it('creates a queued source before preserving its evidence fields', async () => {
    const createSource = vi.fn().mockResolvedValue({ Id: 21 });
    const createCitation = vi.fn().mockResolvedValue({});
    const client = { sources: { create: createSource }, citations: { create: createCitation } } as never;
    const newSource = {
      Title: 'New register', Type: 'Vital', Author: null, RepositoryName: null,
      CallNumber: null, Text: null, PublicationInfo: null, Contents: null,
    };

    await attachPendingCommentCitation(client, {
      factTable: 'CaseComments', factLabel: 'Entry', newSource,
      page: 'p. 8', quay: '2', dataText: 'Transcription',
    }, 45, null);

    expect(createSource).toHaveBeenCalledWith(newSource, null);
    expect(createCitation).toHaveBeenCalledWith(expect.objectContaining({
      FactId: 45, SourceId: 21, Page: 'p. 8', Quay: '2', DataText: 'Transcription',
    }), null);
  });
});
