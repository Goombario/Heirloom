import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ensureBackupFolder,
  uploadBackup,
  listBackups,
  downloadBackup,
  deleteBackup,
  pruneBackups,
  selectStaleBackups,
  type DriveFile,
} from '@/lib/data/drive/client';

const TOKEN = 'test-access-token';

/** Build a Response-like object with .ok, .json, .text, .blob. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    blob: async () => new Blob([JSON.stringify(body)]),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The single URL string passed to the Nth fetch call. */
function urlOf(call = 0): string {
  return String(fetchMock.mock.calls[call][0]);
}
function initOf(call = 0): RequestInit {
  return (fetchMock.mock.calls[call][1] ?? {}) as RequestInit;
}

describe('drive client — auth header', () => {
  it('sends the bearer token on every request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [{ id: 'f1' }] }));
    await ensureBackupFolder(TOKEN);
    const headers = initOf(0).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('throws on a non-2xx response, including the status', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('quota exceeded', false, 403));
    await expect(listBackups(TOKEN, 'folder1')).rejects.toThrow(/403/);
  });
});

describe('ensureBackupFolder', () => {
  it('returns the existing folder id without creating one', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [{ id: 'existing-folder' }] }));
    const id = await ensureBackupFolder(TOKEN);
    expect(id).toBe('existing-folder');
    expect(fetchMock).toHaveBeenCalledTimes(1); // no create call
    expect(urlOf(0)).toContain('Heirloom');
    expect(urlOf(0)).toContain('vnd.google-apps.folder');
  });

  it('creates the folder when none exists', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ files: [] })) // search: none
      .mockResolvedValueOnce(jsonResponse({ id: 'new-folder' })); // create
    const id = await ensureBackupFolder(TOKEN);
    expect(id).toBe('new-folder');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(initOf(1).method).toBe('POST');
    expect(String(initOf(1).body)).toContain('Heirloom');
  });
});

describe('uploadBackup', () => {
  it('POSTs multipart to the upload endpoint, parented + tagged', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'file1', name: 'heirloom-backup-x.tar', modifiedTime: '2026-07-01T00:00:00Z' }),
    );
    const blob = new Blob(['tar-bytes']);
    const file = await uploadBackup(TOKEN, blob, 'folder1', 'heirloom-backup-x.tar');

    expect(file.id).toBe('file1');
    expect(urlOf(0)).toContain('/upload/drive/v3/files');
    expect(urlOf(0)).toContain('uploadType=multipart');
    expect(initOf(0).method).toBe('POST');
    expect(initOf(0).body).toBeInstanceOf(FormData);

    // metadata part carries the parent folder + appProperties tag
    const form = initOf(0).body as FormData;
    const metaBlob = form.get('metadata') as Blob;
    const metaText = await metaBlob.text();
    expect(metaText).toContain('"parents":["folder1"]');
    expect(metaText).toContain('"heirloom":"backup"');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });
});

describe('listBackups', () => {
  it('scopes the query to the folder + tag and orders newest-first', async () => {
    const files: DriveFile[] = [{ id: 'a', name: 'a.tar', modifiedTime: '2026-07-02T00:00:00Z' }];
    fetchMock.mockResolvedValueOnce(jsonResponse({ files }));
    const out = await listBackups(TOKEN, 'folder1');
    expect(out).toEqual(files);
    const url = urlOf(0);
    expect(url).toContain(encodeURIComponent("'folder1' in parents"));
    expect(url).toContain(encodeURIComponent('modifiedTime desc'));
    expect(url).toContain('heirloom');
  });

  it('returns [] when Drive omits the files array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    expect(await listBackups(TOKEN, 'folder1')).toEqual([]);
  });
});

describe('downloadBackup', () => {
  it('requests alt=media and returns a Blob', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ any: 'bytes' }));
    const blob = await downloadBackup(TOKEN, 'file9');
    expect(blob).toBeInstanceOf(Blob);
    expect(urlOf(0)).toContain('/files/file9?alt=media');
  });
});

describe('deleteBackup', () => {
  it('issues a DELETE to the file resource', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, true, 204));
    await deleteBackup(TOKEN, 'file9');
    expect(urlOf(0)).toContain('/files/file9');
    expect(initOf(0).method).toBe('DELETE');
  });
});

describe('selectStaleBackups (pure retention)', () => {
  const mk = (id: string, t: string): DriveFile => ({ id, name: `${id}.tar`, modifiedTime: t });

  it('returns nothing when at or below the limit', () => {
    const files = [mk('a', '2026-07-03T00:00:00Z'), mk('b', '2026-07-02T00:00:00Z')];
    expect(selectStaleBackups(files, 10)).toEqual([]);
    expect(selectStaleBackups(files, 2)).toEqual([]);
  });

  it('keeps the newest N and returns the rest, regardless of input order', () => {
    // Deliberately unsorted input.
    const files = [
      mk('old', '2026-01-01T00:00:00Z'),
      mk('new', '2026-07-01T00:00:00Z'),
      mk('mid', '2026-04-01T00:00:00Z'),
    ];
    expect(selectStaleBackups(files, 1)).toEqual(['mid', 'old']);
    expect(selectStaleBackups(files, 2)).toEqual(['old']);
  });

  it('enforces keep-10 on an 12-item set (drops the 2 oldest)', () => {
    const files = Array.from({ length: 12 }, (_, i) =>
      mk(`f${i}`, `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    );
    const stale = selectStaleBackups(files, 10);
    expect(stale).toEqual(['f1', 'f0']); // the two oldest
    expect(stale).toHaveLength(2);
  });
});

describe('pruneBackups', () => {
  it('lists then deletes only the backups beyond the newest 10', async () => {
    const files: DriveFile[] = Array.from({ length: 12 }, (_, i) => ({
      id: `f${i}`,
      name: `f${i}.tar`,
      modifiedTime: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ files })); // listBackups
    fetchMock.mockResolvedValue(jsonResponse({}, true, 204)); // deletes

    await pruneBackups(TOKEN, 'folder1', 10);

    // 1 list + 2 deletes
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const deleteUrls = fetchMock.mock.calls.slice(1).map((c) => String(c[0]));
    expect(deleteUrls.some((u) => u.includes('/files/f0'))).toBe(true);
    expect(deleteUrls.some((u) => u.includes('/files/f1'))).toBe(true);
  });

  it('deletes nothing when under the limit', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ files: [{ id: 'a', name: 'a.tar', modifiedTime: '2026-07-01T00:00:00Z' }] }),
    );
    await pruneBackups(TOKEN, 'folder1', 10);
    expect(fetchMock).toHaveBeenCalledTimes(1); // list only
  });
});
