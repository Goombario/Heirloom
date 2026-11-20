import { describe, expect, it } from 'vitest';
import { BACKUP_OLD_AFTER_DAYS, backupAge } from '@/app/import-export/desktop/lastBackup';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-20T12:00:00Z');

describe('backupAge (#193)', () => {
  it('none when this device has no backup', () => {
    expect(backupAge(null, NOW)).toEqual({ kind: 'none' });
  });
  it('recent up to the threshold, old after it', () => {
    expect(backupAge(NOW - DAY, NOW).kind).toBe('recent');
    expect(backupAge(NOW - BACKUP_OLD_AFTER_DAYS * DAY, NOW).kind).toBe('recent');
    expect(backupAge(NOW - BACKUP_OLD_AFTER_DAYS * DAY - 1, NOW).kind).toBe('old');
  });
});
