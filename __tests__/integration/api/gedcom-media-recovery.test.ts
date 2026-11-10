import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  user: vi.fn(async () => ({ id: 7, email: 'recovery@example.test', name: null, googleId: 'recovery' })),
  list: vi.fn(async () => [{ id: 1, status: 'pending' }]),
  mark: vi.fn(async () => [{ id: 1, status: 'missing', failureCode: 'archive_file_missing' }]),
  materialize: vi.fn(async () => ({ outcome: 'ready', item: { id: 1 }, failureCode: null, retryable: false })),
  remove: vi.fn(async () => undefined),
  removeBatch: vi.fn(async () => [1, 2]),
  rateLimit: vi.fn(() => ({ success: true, remaining: 29 })),
}));

vi.mock('@/lib/auth/get-user-from-request', () => ({ getUserFromRequest: state.user }));
vi.mock('@/lib/services/media-import-items', () => ({
  MAX_MISSING_MEDIA_BATCH: 100,
  listUnresolvedImportMediaService: state.list,
  markImportMediaMissingService: state.mark,
  removeUnresolvedImportMediaService: state.remove,
  removeUnresolvedImportMediaBatchService: state.removeBatch,
}));
vi.mock('@/lib/services/media-upload', () => ({ materializeImportMediaService: state.materialize }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: state.rateLimit }));

describe('GEDCOM media recovery routes', () => {
  it('propagates active tree scope and returns the typed PATCH outcome', async () => {
    const { PATCH } = await import('@/app/api/import/gedcom/media/route');
    const request = new NextRequest('http://localhost/api/import/gedcom/media?treeId=42', {
      method: 'PATCH', body: JSON.stringify({ itemIds: [1, 2] }), headers: { 'content-type': 'application/json' },
    });
    const response = await PATCH(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ count: 1 });
    expect(state.mark).toHaveBeenCalledWith(expect.objectContaining({ requestedTreeId: 42, itemIds: [1, 2] }));
  });

  it('awaits dynamic params and returns materialization JSON plus a 204 delete', async () => {
    const route = await import('@/app/api/import/gedcom/media/[id]/route');
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const post = await route.POST(
      new NextRequest('http://localhost/api/import/gedcom/media/1?treeId=42', {
        method: 'POST', body: (() => { const fd = new FormData(); fd.append('archivePath', 'media/M1/photo.jpg'); fd.append('file', file); return fd; })(),
      }),
      { params: Promise.resolve({ id: '1' }) },
    );
    expect(post.status).toBe(200);
    expect(await post.json()).toMatchObject({ outcome: 'ready' });
    expect(state.materialize).toHaveBeenCalledWith(expect.objectContaining({ itemId: 1, requestedTreeId: 42, archivePath: 'media/M1/photo.jpg' }));

    const deleted = await route.DELETE(
      new NextRequest('http://localhost/api/import/gedcom/media/1?treeId=42', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '1' }) },
    );
    expect(deleted.status).toBe(204);
    expect(state.remove).toHaveBeenCalledWith(expect.objectContaining({ itemId: 1, requestedTreeId: 42 }));
  });

  it('rejects a missing batch over the documented cap before calling the service', async () => {
    state.mark.mockClear();
    const { PATCH } = await import('@/app/api/import/gedcom/media/route');
    const request = new NextRequest('http://localhost/api/import/gedcom/media?treeId=42', {
      method: 'PATCH',
      body: JSON.stringify({ itemIds: Array.from({ length: 101 }, (_, index) => index + 1) }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await PATCH(request);

    expect(response.status).toBe(400);
    expect(state.mark).not.toHaveBeenCalled();
  });

  it('rate-limits authenticated missing batches by user before the service call', async () => {
    state.mark.mockClear();
    state.rateLimit.mockReturnValueOnce({ success: false, remaining: 0 });
    const { PATCH } = await import('@/app/api/import/gedcom/media/route');
    const request = new NextRequest('http://localhost/api/import/gedcom/media?treeId=42', {
      method: 'PATCH',
      body: JSON.stringify({ itemIds: [1] }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await PATCH(request);

    expect(response.status).toBe(429);
    expect(state.rateLimit).toHaveBeenCalledWith('7:import-missing', expect.any(Number), expect.any(Number));
    expect(state.mark).not.toHaveBeenCalled();
  });

  it('rate-limits authenticated unresolved deletion by user before the destructive service call', async () => {
    state.remove.mockClear();
    state.rateLimit.mockReturnValueOnce({ success: false, remaining: 0 });
    const route = await import('@/app/api/import/gedcom/media/[id]/route');
    const response = await route.DELETE(
      new NextRequest('http://localhost/api/import/gedcom/media/1?treeId=42', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '1' }) },
    );

    expect(response.status).toBe(429);
    expect(state.rateLimit).toHaveBeenCalledWith('7:import-remove', expect.any(Number), expect.any(Number));
    expect(state.remove).not.toHaveBeenCalled();
  });

  it('bulk-removes unresolved items in one request with its own per-request budget (#859)', async () => {
    state.removeBatch.mockClear();
    const { DELETE } = await import('@/app/api/import/gedcom/media/route');
    const response = await DELETE(new NextRequest('http://localhost/api/import/gedcom/media?treeId=42', {
      method: 'DELETE', body: JSON.stringify({ itemIds: [1, 2, 3] }), headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removedIds: [1, 2], count: 2 });
    expect(state.rateLimit).toHaveBeenCalledWith('7:import-remove-batch', expect.any(Number), expect.any(Number));
    expect(state.removeBatch).toHaveBeenCalledWith(expect.objectContaining({ requestedTreeId: 42, currentUserId: 7, itemIds: [1, 2, 3] }));
  });

  it('rejects a bulk remove over the cap, or rate-limited, before the destructive service call', async () => {
    state.removeBatch.mockClear();
    const { DELETE } = await import('@/app/api/import/gedcom/media/route');
    const tooMany = await DELETE(new NextRequest('http://localhost/api/import/gedcom/media', {
      method: 'DELETE',
      body: JSON.stringify({ itemIds: Array.from({ length: 101 }, (_, index) => index + 1) }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(tooMany.status).toBe(400);

    state.rateLimit.mockReturnValueOnce({ success: false, remaining: 0 });
    const limited = await DELETE(new NextRequest('http://localhost/api/import/gedcom/media', {
      method: 'DELETE', body: JSON.stringify({ itemIds: [1] }), headers: { 'content-type': 'application/json' },
    }));
    expect(limited.status).toBe(429);
    expect(state.removeBatch).not.toHaveBeenCalled();
  });
});
