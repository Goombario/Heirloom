import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleApiError } from '@/lib/api/handle-error';
import { NotFoundError } from '@/lib/data/errors';

afterEach(() => { vi.restoreAllMocks(); });

describe('handleApiError correlation id (#8)', () => {
  it('returns the same short id in the 500 body and the logged line', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = handleApiError(new Error('pool exhausted'), 'Failed to fetch places');
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to fetch places');
    expect(body.errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(body)).not.toContain('pool exhausted');
    expect(log).toHaveBeenCalledWith(`[error ${body.errorId}] Failed to fetch places`, expect.any(Error));
  });

  it('leaves mapped errors without an id', async () => {
    const body = await handleApiError(new NotFoundError('Person not found')).json();
    expect(body).toEqual({ error: 'Person not found' });
  });
});
