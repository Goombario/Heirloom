import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getUserFromRequest, previewGedcomService, importGedcomService, rateLimit } = vi.hoisted(() => ({
  getUserFromRequest: vi.fn(),
  previewGedcomService: vi.fn(),
  importGedcomService: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@/lib/auth/get-user-from-request', () => ({ getUserFromRequest }));
vi.mock('@/lib/services/gedcom', () => ({ previewGedcomService, importGedcomService }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit }));

import { POST } from '@/app/api/import/gedcom/route';

function request(query: string): NextRequest {
  const formData = new FormData();
  formData.append('file', new File(['0 HEAD\n0 TRLR'], 'test.ged', { type: 'text/plain' }));
  return new NextRequest(`http://localhost/api/import/gedcom?${query}`, { method: 'POST', body: formData });
}

describe('POST /api/import/gedcom rate-limit and tree routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserFromRequest.mockResolvedValue({ id: 42 });
    rateLimit.mockReturnValue({ success: true, remaining: 99 });
    previewGedcomService.mockResolvedValue({ dryRun: true });
    importGedcomService.mockResolvedValue({ dryRun: false });
  });

  it('uses a separate generous bucket for read-only previews', async () => {
    const response = await POST(request('mode=overwrite&dryRun=true&treeId=7'));

    expect(response.status).toBe(200);
    expect(rateLimit).toHaveBeenCalledWith('42:import-preview', 30, 15 * 60 * 1000);
    expect(previewGedcomService).toHaveBeenCalledWith(expect.objectContaining({
      currentUserId: 42,
    }));
    expect(importGedcomService).not.toHaveBeenCalled();
  });

  it('keeps the destructive import budget at five requests', async () => {
    const response = await POST(request('mode=overwrite&treeId=7'));

    expect(response.status).toBe(200);
    expect(rateLimit).toHaveBeenCalledWith('42:import', 5, 15 * 60 * 1000);
    expect(importGedcomService).toHaveBeenCalledWith(expect.objectContaining({
      requestedTreeId: 7,
      requestedOwnerId: null,
    }));
  });

  it('returns 429 only when the selected bucket is exhausted', async () => {
    rateLimit.mockReturnValue({ success: false, remaining: 0 });

    const response = await POST(request('mode=overwrite&treeId=7'));

    expect(response.status).toBe(429);
    expect(importGedcomService).not.toHaveBeenCalled();
  });
});

describe('POST /api/import/gedcom constraint errors (#874)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserFromRequest.mockResolvedValue({ id: 42 });
    rateLimit.mockReturnValue({ success: true, remaining: 99 });
  });

  it('returns 409 without the raw constraint text', async () => {
    const err = Object.assign(
      new Error('duplicate key value violates unique constraint "FamilyPerson_pkey"'),
      { code: '23505' },
    );
    importGedcomService.mockRejectedValue(err);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(request('mode=overwrite&treeId=7'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('23505');
    expect(body.error).not.toMatch(/FamilyPerson|constraint/);
  });
});
