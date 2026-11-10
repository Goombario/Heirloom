import { describe, it, expect } from 'vitest';
import {
  computeBackupStatus,
  STALE_AFTER_DAYS,
  AGING_AFTER_DAYS,
} from '@/lib/data/backup-status';

const NOW = new Date('2026-07-01T12:00:00Z');
/** ISO string for `days` before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('computeBackupStatus', () => {
  it('is "never" when there is no backup at all', () => {
    const s = computeBackupStatus(null, null, NOW);
    expect(s.level).toBe('never');
    expect(s.lastBackup).toBeNull();
    expect(s.ageDays).toBeNull();
  });

  it('is "fresh" just under the aging threshold', () => {
    const s = computeBackupStatus(daysAgo(AGING_AFTER_DAYS - 1), null, NOW);
    expect(s.level).toBe('fresh');
    expect(s.ageDays).toBe(AGING_AFTER_DAYS - 1);
  });

  it('flips to "aging" exactly at the aging threshold', () => {
    expect(computeBackupStatus(daysAgo(AGING_AFTER_DAYS), null, NOW).level).toBe('aging');
    expect(computeBackupStatus(daysAgo(STALE_AFTER_DAYS - 1), null, NOW).level).toBe('aging');
  });

  it('flips to "stale" exactly at the stale threshold', () => {
    expect(computeBackupStatus(daysAgo(STALE_AFTER_DAYS), null, NOW).level).toBe('stale');
    expect(computeBackupStatus(daysAgo(365), null, NOW).level).toBe('stale');
  });

  it('picks the most recent of file vs Drive', () => {
    // Drive newer than file → uses Drive (fresh), not file (stale).
    const s = computeBackupStatus(daysAgo(30), daysAgo(1), NOW);
    expect(s.level).toBe('fresh');
    expect(s.ageDays).toBe(1);
  });

  it('picks file when it is the most recent', () => {
    const s = computeBackupStatus(daysAgo(2), daysAgo(40), NOW);
    expect(s.level).toBe('fresh');
    expect(s.ageDays).toBe(2);
  });

  it('uses whichever single timestamp is present', () => {
    expect(computeBackupStatus(null, daysAgo(3), NOW).ageDays).toBe(3);
    expect(computeBackupStatus(daysAgo(5), null, NOW).ageDays).toBe(5);
  });

  it('treats an unparseable timestamp as absent', () => {
    expect(computeBackupStatus('not-a-date', null, NOW).level).toBe('never');
    // garbage file value, valid drive value → uses drive
    expect(computeBackupStatus('garbage', daysAgo(1), NOW).level).toBe('fresh');
  });

  it('never reports a negative age for a future timestamp', () => {
    const future = new Date(NOW.getTime() + 5 * 86400000).toISOString();
    expect(computeBackupStatus(future, null, NOW).ageDays).toBe(0);
  });
});
