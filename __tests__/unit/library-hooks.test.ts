/**
 * @vitest-environment happy-dom
 *
 * Unit tests for the useLibrarySources and useSourceEditor hooks. Mocks
 * getDataClient so no DB or network is required. Does NOT boot PGlite —
 * safe in test:fast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { SourceWithCitationCount } from '@/lib/db/queries/sources';
import type { Source } from '@/lib/db/queries/sources';
import type { CitedByRow } from '@/lib/db/queries/citations';
import type { MediaWithPerson } from '@/lib/db/schema';
import { NotFoundError } from '@/lib/data/errors';

// ---- Mock getDataClient -------------------------------------------------
const listSourcesMock = vi.fn();
const listMediaMock = vi.fn();
const getSourceMock = vi.fn();
const citedByMock = vi.fn();
const createSourceMock = vi.fn();
const updateSourceMock = vi.fn();
const removeSourceMock = vi.fn();
const redirectIfUnauthorizedMock = vi.hoisted(() => vi.fn().mockReturnValue(false));
const translateMock = vi.hoisted(() => (key: string) => key);

vi.mock('next-intl', () => ({
  useTranslations: () => translateMock,
}));

vi.mock('@/lib/data', () => ({
  getDataClient: () =>
    Promise.resolve({
      sources: {
        list: listSourcesMock,
        get: getSourceMock,
        citedBy: citedByMock,
        create: createSourceMock,
        update: updateSourceMock,
        remove: removeSourceMock,
      },
      media: { list: listMediaMock },
    }),
}));

// ---- Mock handleDataError (prevents window.location redirect) -----------
vi.mock('@/lib/utils/data-error', () => ({
  handleDataError: vi.fn().mockReturnValue(false),
  errorToastKey: vi.fn().mockReturnValue('error_generic'),
}));
vi.mock('@/app/components/useErrorToast', () => ({
  useErrorToast: () => ({ redirectIfUnauthorized: redirectIfUnauthorizedMock, reportError: vi.fn() }),
}));

// Import AFTER mocks are set up
import { useLibrarySources } from '@/app/library/useLibrarySources';
import { useSourceEditor } from '@/app/library/useSourceEditor';
import { emptySourceForm } from '@/app/components/SourceFields';

// ---- Fixtures -----------------------------------------------------------
const FIXTURE_SOURCE: SourceWithCitationCount = {
  Id: 1,
  OwnerId: 99,
  Title: 'Baptismal Register 1842',
  Author: 'Parish of St. Mary',
  PublicationInfo: null,
  RepositoryName: 'County Archive',
  CallNumber: null,
  Text: null,
  Type: 'Church',
  Contents: null,
  Num: null,
  citationCount: 3,
  citedByPeople: [],
};

const FIXTURE_PHOTO: MediaWithPerson = {
  Id: 10,
  UserId: 99,
  Title: 'Family Portrait 1890',
  FilePath: 'uploads/portrait.jpg',
  Format: 'jpeg',
  ContentType: 'image/jpeg',
  PersonFirstName: 'Jane',
  PersonLastName: 'Doe',
};

// ---- Tests --------------------------------------------------------------
describe('useLibrarySources', () => {
  beforeEach(() => {
    listSourcesMock.mockResolvedValue({ sources: [FIXTURE_SOURCE], count: 1 });
    listMediaMock.mockResolvedValue({ media: [FIXTURE_PHOTO], count: 1 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts loading=true and resolves sources + photos after mount', async () => {
    const { result } = renderHook(() => useLibrarySources(99, true));

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sources).toEqual([FIXTURE_SOURCE]);
    expect(result.current.photos).toEqual([FIXTURE_PHOTO]);
    expect(result.current.error).toBeNull();
  });

  it('calls sources.list with withCounts:true and treeId', async () => {
    const { result } = renderHook(() => useLibrarySources(99, true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listSourcesMock).toHaveBeenCalledOnce();
    expect(listSourcesMock).toHaveBeenCalledWith(
      expect.objectContaining({ withCounts: true, treeId: 99 }),
    );
  });

  it('calls media.list with withPerson:true and treeId', async () => {
    const { result } = renderHook(() => useLibrarySources(99, true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listMediaMock).toHaveBeenCalledOnce();
    expect(listMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({ withPerson: true, treeId: 99 }),
    );
  });

  it('does not fetch when disabled (user not yet resolved)', () => {
    renderHook(() => useLibrarySources(null, false));
    expect(listSourcesMock).not.toHaveBeenCalled();
    expect(listMediaMock).not.toHaveBeenCalled();
  });

  it('refetch re-calls both sources.list and media.list', async () => {
    const { result } = renderHook(() => useLibrarySources(99, true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listSourcesMock).toHaveBeenCalledTimes(1);
    expect(listMediaMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(listSourcesMock).toHaveBeenCalledTimes(2);
    expect(listMediaMock).toHaveBeenCalledTimes(2);
  });

  it('keeps source and photo failures independent and retries only the failed resource', async () => {
    const sourceFailure = new Error('source down');
    listSourcesMock.mockRejectedValueOnce(sourceFailure);
    const { result } = renderHook(() => useLibrarySources(99, true));

    await waitFor(() => expect(result.current.sourceError).toBe(sourceFailure));
    expect(result.current.photoError).toBeNull();
    expect(result.current.photos).toEqual([FIXTURE_PHOTO]);

    listSourcesMock.mockResolvedValueOnce({ sources: [FIXTURE_SOURCE], count: 1 });
    await act(async () => { await result.current.retrySources(); });

    expect(result.current.sourceError).toBeNull();
    expect(listSourcesMock).toHaveBeenCalledTimes(2);
    expect(listMediaMock).toHaveBeenCalledTimes(1);
  });

  it('reports a failed photo read without clearing loaded sources', async () => {
    const photoFailure = new Error('photos down');
    listMediaMock.mockRejectedValueOnce(photoFailure);
    const { result } = renderHook(() => useLibrarySources(99, true));

    await waitFor(() => expect(result.current.photoError).toBe(photoFailure));
    expect(result.current.sourceError).toBeNull();
    expect(result.current.sources).toEqual([FIXTURE_SOURCE]);
  });

  it('hides prior-tree resources immediately and keeps failures scoped to the new tree', async () => {
    const { result, rerender } = renderHook(
      ({ treeId }: { treeId: number }) => useLibrarySources(treeId, true),
      { initialProps: { treeId: 99 } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sources).toEqual([FIXTURE_SOURCE]);
    expect(result.current.photos).toEqual([FIXTURE_PHOTO]);

    const sourceFailure = new Error('new tree sources failed');
    const photoFailure = new Error('new tree photos failed');
    listSourcesMock.mockRejectedValueOnce(sourceFailure);
    listMediaMock.mockRejectedValueOnce(photoFailure);
    rerender({ treeId: 100 });

    expect(result.current.sources).toEqual([]);
    expect(result.current.photos).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(result.current.photoLoading).toBe(true);
    await waitFor(() => expect(result.current.sourceError).toBe(sourceFailure));
    await waitFor(() => expect(result.current.photoError).toBe(photoFailure));
    expect(result.current.sources).toEqual([]);
    expect(result.current.photos).toEqual([]);
  });

  it('tracks photo loading independently from the source list', async () => {
    let resolvePhotos!: (value: { media: MediaWithPerson[]; count: number }) => void;
    listMediaMock.mockImplementationOnce(() => new Promise((resolve) => { resolvePhotos = resolve; }));
    const { result } = renderHook(() => useLibrarySources(99, true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.photoLoading).toBe(true);
    expect(result.current.photos).toEqual([]);

    resolvePhotos({ media: [FIXTURE_PHOTO], count: 1 });
    await waitFor(() => expect(result.current.photoLoading).toBe(false));
    expect(result.current.photos).toEqual([FIXTURE_PHOTO]);
  });

  it('revalidates sources on focus without replacing loaded content with the skeleton', async () => {
    const { result } = renderHook(() => useLibrarySources(99, true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const sourcesBefore = listSourcesMock.mock.calls.length;
    const photosBefore = listMediaMock.mock.calls.length;
    let resolveFocus!: (value: { sources: SourceWithCitationCount[]; count: number }) => void;
    listSourcesMock.mockImplementationOnce(() => new Promise((resolve) => { resolveFocus = resolve; }));

    act(() => { window.dispatchEvent(new Event('focus')); });

    await waitFor(() => expect(listSourcesMock.mock.calls.length).toBe(sourcesBefore + 1));
    expect(result.current.loading).toBe(false);
    expect(result.current.sources).toEqual([FIXTURE_SOURCE]);
    expect(listMediaMock.mock.calls.length).toBe(photosBefore);

    await act(async () => {
      resolveFocus({ sources: [FIXTURE_SOURCE], count: 1 });
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);
  });

  it('finishes initial loading when focus supersedes the first source request', async () => {
    let resolveInitial!: (value: { sources: SourceWithCitationCount[]; count: number }) => void;
    listSourcesMock.mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }));
    const { result } = renderHook(() => useLibrarySources(99, true));
    await waitFor(() => expect(listSourcesMock).toHaveBeenCalledTimes(1));
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(listSourcesMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sources).toEqual([FIXTURE_SOURCE]);
    await act(async () => { resolveInitial({ sources: [], count: 0 }); });
    expect(result.current.sources).toEqual([FIXTURE_SOURCE]);
  });

  it('returns empty arrays and loading=true while disabled', () => {
    const { result } = renderHook(() => useLibrarySources(null, false));
    expect(result.current.sources).toEqual([]);
    expect(result.current.photos).toEqual([]);
    // loading stays true because fetchSources never runs to call setLoading(false)
    expect(result.current.loading).toBe(true);
  });
});

// ============================================================
// useSourceEditor
// ============================================================

const FIXTURE_SOURCE_DETAIL: Source = {
  Id: 42,
  OwnerId: 99,
  Title: 'Baptismal Register 1842',
  Author: 'Parish of St. Mary',
  PublicationInfo: 'County Archive Publication 1900',
  RepositoryName: 'County Archive',
  CallNumber: 'REG/1842',
  Text: 'https://example.com/register',
  Type: 'Church',
  Contents: null,
  Num: 3,
};

const FIXTURE_CITED_BY: CitedByRow[] = [
  {
    citationId: 1,
    factTable: 'People',
    factId: 10,
    personName: 'Jane Doe',
    eventType: null,
    eventDate: null,
    variantType: null,
    variantName: null,
    caseTitle: null,
    personId: 10,
    caseId: null,
    personSex: 'F',
    personMediaId: null,
    familyId: null,
    familyPartner1Name: null,
    familyPartner1Sex: null,
    familyPartner1MediaId: null,
    familyPartner2Name: null,
    familyPartner2Sex: null,
    familyPartner2MediaId: null,
    page: null, quay: null, dataText: null, factDate: null, factPlace: null, sortableYear: null,
  },
];

describe('useSourceEditor', () => {
  beforeEach(() => {
    getSourceMock.mockResolvedValue(FIXTURE_SOURCE_DETAIL);
    citedByMock.mockResolvedValue(FIXTURE_CITED_BY);
    createSourceMock.mockResolvedValue({ ...FIXTURE_SOURCE_DETAIL, Id: 100 });
    updateSourceMock.mockResolvedValue(FIXTURE_SOURCE_DETAIL);
    removeSourceMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('load mode: populates form from loaded source and fills citedBy', async () => {
    const { result } = renderHook(() => useSourceEditor(42, 99));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.source).toEqual(FIXTURE_SOURCE_DETAIL);
    expect(result.current.citedBy).toEqual(FIXTURE_CITED_BY);
    expect(result.current.form.Title).toBe('Baptismal Register 1842');
    expect(result.current.form.Type).toBe('Church');
    expect(result.current.form.Author).toBe('Parish of St. Mary');
    expect(result.current.form.RepositoryName).toBe('County Archive');
    expect(result.current.form.CallNumber).toBe('REG/1842');
    expect(result.current.form.Text).toBe('https://example.com/register');
    expect(result.current.form.PublicationInfo).toBe('County Archive Publication 1900');
    // null fields become empty strings
    expect(result.current.form.Contents).toBe('');
  });

  it('hides an old source and disables its form immediately when the tree changes', async () => {
    let resolveNext!: (value: Source) => void;
    const { result, rerender } = renderHook(
      ({ treeId }) => useSourceEditor(42, treeId),
      { initialProps: { treeId: 99 } },
    );
    await waitFor(() => expect(result.current.source).toEqual(FIXTURE_SOURCE_DETAIL));

    getSourceMock.mockReturnValueOnce(new Promise(resolve => { resolveNext = resolve; }));
    rerender({ treeId: 100 });

    expect(result.current.source).toBeNull();
    expect(result.current.form).toEqual(emptySourceForm);
    expect(result.current.titleValid).toBe(false);
    expect(result.current.loading).toBe(true);

    await act(async () => { resolveNext({ ...FIXTURE_SOURCE_DETAIL, Title: 'Tree 100 source' }); });
    await waitFor(() => expect(result.current.source?.Title).toBe('Tree 100 source'));
  });

  it('preserves the typed source-not-found state instead of making it retryable generic failure', async () => {
    getSourceMock.mockRejectedValueOnce(new NotFoundError('private server detail'));
    const { result } = renderHook(() => useSourceEditor(42, 99));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(true);
    expect(result.current.loadError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.source).toBeNull();
  });

  it('does not apply or expose a save that finishes after the source scope changes', async () => {
    let resolveSave!: (value: Source) => void;
    updateSourceMock.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
    const { result, rerender } = renderHook(
      ({ sourceId, treeId }) => useSourceEditor(sourceId, treeId),
      { initialProps: { sourceId: 42, treeId: 99 } },
    );
    await waitFor(() => expect(result.current.source).toEqual(FIXTURE_SOURCE_DETAIL));

    act(() => result.current.setForm({ Title: 'Saving tree 99' }));
    let saveResult!: Promise<unknown>;
    act(() => { saveResult = result.current.save().catch(error => error); });
    await waitFor(() => expect(updateSourceMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ Title: 'Saving tree 99' }),
      99,
    ));

    const replacement = { ...FIXTURE_SOURCE_DETAIL, Id: 43, Title: 'Tree 100 source' };
    getSourceMock.mockResolvedValueOnce(replacement);
    rerender({ sourceId: 43, treeId: 100 });
    await waitFor(() => expect(result.current.source).toEqual(replacement));

    await act(async () => {
      resolveSave({ ...FIXTURE_SOURCE_DETAIL, Title: 'Saved tree 99' });
      await saveResult;
    });

    expect(result.current.source).toEqual(replacement);
    expect(result.current.form.Title).toBe('Tree 100 source');
    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
  });

  it('new mode: starts with emptySourceForm and empty citedBy', () => {
    const { result } = renderHook(() => useSourceEditor(null, 99));
    expect(result.current.loading).toBe(false);
    expect(result.current.source).toBeNull();
    expect(result.current.citedBy).toEqual([]);
    expect(result.current.form).toEqual(emptySourceForm);
    expect(getSourceMock).not.toHaveBeenCalled();
    expect(citedByMock).not.toHaveBeenCalled();
  });

  it('titleValid: false on empty title (new mode)', () => {
    const { result } = renderHook(() => useSourceEditor(null, 99));
    expect(result.current.titleValid).toBe(false);
  });

  it('titleValid: false on whitespace-only title', async () => {
    const { result } = renderHook(() => useSourceEditor(null, 99));
    act(() => result.current.setForm({ Title: '   ' }));
    expect(result.current.titleValid).toBe(false);
  });

  it('titleValid: true when title has non-whitespace chars', async () => {
    const { result } = renderHook(() => useSourceEditor(null, 99));
    act(() => result.current.setForm({ Title: 'My Source' }));
    expect(result.current.titleValid).toBe(true);
  });

  it('discard restores the last saved form snapshot and clears dirty state', async () => {
    const { result } = renderHook(() => useSourceEditor(42, 99));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setForm({ Title: 'Unsaved draft title' }));
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.discard());
    expect(result.current.form.Title).toBe(FIXTURE_SOURCE_DETAIL.Title);
    expect(result.current.isDirty).toBe(false);
  });

  it('save (new): calls sources.create with form and ownerId', async () => {
    const { result } = renderHook(() => useSourceEditor(null, 99));
    act(() => result.current.setForm({ Title: 'New Register', Type: 'Census' }));

    let saved: Source | undefined;
    await act(async () => {
      saved = await result.current.save();
    });

    expect(createSourceMock).toHaveBeenCalledOnce();
    expect(createSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ Title: 'New Register', Type: 'Census' }),
      99,
    );
    expect(updateSourceMock).not.toHaveBeenCalled();
    expect(saved).toBeDefined();
  });

  it('save (edit): calls sources.update with sourceId, form, and ownerId', async () => {
    const { result } = renderHook(() => useSourceEditor(42, 99));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setForm({ Title: 'Updated Register' }));

    await act(async () => {
      await result.current.save();
    });

    expect(updateSourceMock).toHaveBeenCalledOnce();
    expect(updateSourceMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ Title: 'Updated Register' }),
      99,
    );
    expect(createSourceMock).not.toHaveBeenCalled();
  });

  // ---- Payload normalization (Oral gating + empty→null) -------------------

  it('save (new): trims Title before sending to create', async () => {
    const { result } = renderHook(() => useSourceEditor(null, 99));
    act(() => result.current.setForm({ Title: '  Padded Title  ', Type: 'Document' }));

    await act(async () => {
      await result.current.save();
    });

    expect(createSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ Title: 'Padded Title' }),
      99,
    );
  });

  it('save (new): empty optional fields become null in payload', async () => {
    const { result } = renderHook(() => useSourceEditor(null, 99));
    act(() =>
      result.current.setForm({
        Title: 'Test Source',
        Type: 'Document',
        Author: '',
        RepositoryName: '',
        CallNumber: '',
        Text: '',
        PublicationInfo: '',
      }),
    );

    await act(async () => {
      await result.current.save();
    });

    expect(createSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        Author: null,
        RepositoryName: null,
        CallNumber: null,
        Text: null,
        PublicationInfo: null,
      }),
      99,
    );
  });

  it('save (new): any source type keeps its Contents (#470)', async () => {
    const { result } = renderHook(() => useSourceEditor(null, 99));
    act(() =>
      result.current.setForm({
        Title: 'Census page',
        Type: 'Census',
        Contents: 'Household of John Smith, 4 people',
      }),
    );

    await act(async () => {
      await result.current.save();
    });

    expect(createSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ Contents: 'Household of John Smith, 4 people' }),
      99,
    );
    expect(createSourceMock.mock.calls[0][0]).not.toHaveProperty('ToldBy');
  });

  it('save (new): empty Contents sends null, not empty string', async () => {
    const { result } = renderHook(() => useSourceEditor(null, 99));
    act(() =>
      result.current.setForm({
        Title: 'Empty Oral',
        Type: 'Oral',
        Contents: '',
      }),
    );

    await act(async () => {
      await result.current.save();
    });

    expect(createSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ Contents: null }),
      99,
    );
  });

  it('save (edit): switching type away from Oral keeps Contents (#470)', async () => {
    const { result } = renderHook(() => useSourceEditor(42, 99));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() =>
      result.current.setForm({
        Type: 'Church',
        Contents: 'What was said',
      }),
    );

    await act(async () => {
      await result.current.save();
    });

    expect(updateSourceMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ Type: 'Church', Contents: 'What was said' }),
      99,
    );
  });

  it('save (edit): empty Author in form sends Author: null', async () => {
    const { result } = renderHook(() => useSourceEditor(42, 99));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setForm({ Author: '' }));

    await act(async () => {
      await result.current.save();
    });

    expect(updateSourceMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ Author: null }),
      99,
    );
  });

  it('remove: calls sources.remove with sourceId and ownerId', async () => {
    const { result } = renderHook(() => useSourceEditor(42, 99));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove();
    });

    expect(removeSourceMock).toHaveBeenCalledOnce();
    expect(removeSourceMock).toHaveBeenCalledWith(42, 99);
  });

  it('isDirty: false initially after load (edit mode)', async () => {
    const { result } = renderHook(() => useSourceEditor(42, 99));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isDirty).toBe(false);
  });

  it('isDirty: true after form changes (edit mode)', async () => {
    const { result } = renderHook(() => useSourceEditor(42, 99));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setForm({ Title: 'Changed Title' }));
    expect(result.current.isDirty).toBe(true);
  });

  it('isDirty: false initially (new mode)', () => {
    const { result } = renderHook(() => useSourceEditor(null, 99));
    expect(result.current.isDirty).toBe(false);
  });

  it('isDirty: true after form changes (new mode)', () => {
    const { result } = renderHook(() => useSourceEditor(null, 99));
    act(() => result.current.setForm({ Title: 'New Source' }));
    expect(result.current.isDirty).toBe(true);
  });
});
