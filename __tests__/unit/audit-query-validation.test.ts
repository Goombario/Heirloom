import { describe, it, expect } from 'vitest';
import { getAuditLog } from '@/lib/db/queries/audit';

/**
 * These assert that getAuditLog rejects unsafe dynamic inputs BEFORE building or
 * running any SQL — the guard runs synchronously ahead of the first query, so no
 * database is required.
 */
describe('getAuditLog input validation', () => {
  const base = { page: 1, pageSize: 50 };

  it('rejects an invalid entityType', async () => {
    await expect(getAuditLog(1, { ...base, entityType: 'bogus' })).rejects.toThrow(/Invalid entityType/);
  });

  it('rejects an invalid action', async () => {
    await expect(getAuditLog(1, { ...base, action: 'frobnicate' })).rejects.toThrow(/Invalid action/);
  });

  it('rejects an invalid sort key', async () => {
    await expect(getAuditLog(1, { ...base, sort: 'sideways' })).rejects.toThrow(/Invalid sort/);
  });

  it('rejects an invalid sort direction', async () => {
    await expect(getAuditLog(1, { ...base, dir: 'upways' })).rejects.toThrow(/Invalid dir/);
  });
});
