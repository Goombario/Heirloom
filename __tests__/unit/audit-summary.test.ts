import { describe, it, expect } from 'vitest';
import { summarizeAuditEntry, type SummaryLabels } from '@/lib/utils/audit-summary';
import type { AuditLogEntryWithUser, AuditEntityType } from '@/lib/db/schema';

const LABELS: SummaryLabels = {
  photoAdded: 'Photo added',
  sexPrefix: 'Sex',
  bornPrefix: 'b.',
  diedPrefix: 'd.',
  statusPrefix: 'Status',
  caseStatus: (code) => ({ in_progress: 'In progress', on_hold: 'On hold' })[code] ?? code,
  dataCheck: (action, rule, threshold) => `${action === 'create' ? 'Confirmed' : 'Reopened'}: ${rule} ${threshold}`,
};

function entry(
  partial: {
    action?: 'create' | 'update' | 'delete';
    type?: AuditEntityType;
    changes?: unknown;
  },
): AuditLogEntryWithUser {
  return {
    Id: 1,
    TreeOwnerId: 1,
    UserId: 1,
    Action: partial.action ?? 'create',
    EntityType: partial.type ?? 'person',
    EntityId: 10,
    EntityLabel: 'Test',
    Changes: partial.changes as AuditLogEntryWithUser['Changes'],
    CreatedAt: '2026-07-01T00:00:00Z',
    UserName: 'You',
    UserEmail: null,
  };
}

describe('summarizeAuditEntry', () => {
  it('summarizes a person create with sex, birth year, and place', () => {
    const e = entry({ type: 'person', changes: { snapshot: { Sex: 'F', BirthDate: '1882', BirthPlace: 'Cosenza, Italy' } } });
    expect(summarizeAuditEntry(e, LABELS)).toBe('Sex F · b. 1882 · Cosenza, Italy');
  });

  it('extracts a four-digit year from a longer date string', () => {
    const e = entry({ type: 'person', changes: { snapshot: { BirthDate: '3 MAR 1882' } } });
    expect(summarizeAuditEntry(e, LABELS)).toBe('b. 1882');
  });

  it('summarizes a media create as "Photo added"', () => {
    const e = entry({ type: 'media', changes: { snapshot: { FileName: 'russo.jpg' } } });
    expect(summarizeAuditEntry(e, LABELS)).toBe('Photo added');
  });

  it('summarizes an event create with type and place', () => {
    const e = entry({ type: 'event', changes: { snapshot: { Type: 'Census', Place: 'Kings County, NY' } } });
    expect(summarizeAuditEntry(e, LABELS)).toBe('Census · Kings County, NY');
  });

  it('summarizes a case create with its status', () => {
    const e = entry({ type: 'case', changes: { snapshot: { Status: 'on_hold' } } });
    // The stored code goes through the Cases status names, never "Status on_hold" (#701).
    expect(summarizeAuditEntry(e, LABELS)).toBe('Status On hold');
  });

  it('summarizes on delete as well as create', () => {
    const e = entry({ action: 'delete', type: 'person', changes: { snapshot: { Sex: 'M', BirthDate: '1889' } } });
    expect(summarizeAuditEntry(e, LABELS)).toBe('Sex M · b. 1889');
  });

  it('returns null for update actions', () => {
    const e = entry({ action: 'update', changes: { fields: { BirthPlace: { old: 'a', new: 'b' } } } });
    expect(summarizeAuditEntry(e, LABELS)).toBeNull();
  });

  it('returns null for an empty snapshot', () => {
    const e = entry({ type: 'person', changes: { snapshot: {} } });
    expect(summarizeAuditEntry(e, LABELS)).toBeNull();
  });

  it('returns null (never throws) for malformed Changes', () => {
    expect(summarizeAuditEntry(entry({ changes: null }), LABELS)).toBeNull();
    expect(summarizeAuditEntry(entry({ changes: 'oops' }), LABELS)).toBeNull();
    expect(summarizeAuditEntry(entry({ changes: { fields: {} } }), LABELS)).toBeNull();
  });
});
