import { describe, it, expect } from 'vitest';
import { auditImport } from '@/lib/db/queries/audit-capture';

/**
 * `auditImport` writes ONE summary AuditLog row for a GEDCOM/spreadsheet import
 * (FUNC-5). We pass a mock `exec` (Queryable) to capture the INSERT without a DB.
 */
describe('auditImport', () => {
  function mockExec() {
    const calls: { sql: string; params: unknown[] }[] = [];
    return {
      calls,
      exec: {
        query: async (sql: string, params: unknown[]) => {
          calls.push({ sql, params });
          return { rows: [] };
        },
      },
    };
  }

  it('writes exactly one import entry with the expected shape', async () => {
    const { calls, exec } = mockExec();
    await auditImport('overwrite', { people: 9, families: 3, sources: 2 }, 42, 7, exec);

    expect(calls).toHaveLength(1);
    const { sql, params } = calls[0];
    expect(sql).toContain('INSERT INTO "AuditLog"');
    // [TreeOwnerId, UserId, TreeId, Action, EntityType, EntityId, EntityLabel, Changes]
    expect(params[0]).toBe(42);        // TreeOwnerId
    expect(params[1]).toBe(7);         // UserId (acting editor)
    expect(params[2]).toBeNull();      // TreeId (none passed — multi-tree scope)
    expect(params[3]).toBe('create');  // Action
    expect(params[4]).toBe('import');  // EntityType
    expect(params[5]).toBe(0);         // EntityId sentinel
  });

  it('summarizes counts + mode in the label', async () => {
    const { calls, exec } = mockExec();
    await auditImport('overwrite', { people: 9, families: 3 }, 1, 1, exec);
    const label = calls[0].params[6] as string;
    expect(label).toContain('9 people');
    expect(label).toContain('3 families');
    expect(label).toContain('overwrite');
  });

  it('persists structured counts in Changes for localized rendering', async () => {
    const { calls, exec } = mockExec();
    await auditImport('merge', { people: 4, families: 1, sources: 0 }, 1, 1, exec);
    const changes = JSON.parse(calls[0].params[7] as string);
    expect(changes.snapshot).toMatchObject({ mode: 'merge', people: 4, families: 1, sources: 0 });
  });
});
