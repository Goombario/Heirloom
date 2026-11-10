import { it, expect, vi, beforeEach } from 'vitest';

const container = vi.hoisted(() => ({
  verifyContainer: vi.fn(() => Promise.resolve({ mediaCount: 0 })),
}));
vi.mock('@/lib/db/backup-container', () => container);
vi.mock('@/lib/db/connection.pglite', () => ({
  dumpDatabaseLogical: vi.fn(() => Promise.resolve(new Blob(['gz']))),
  inspectBackupLogical: vi.fn(() => Promise.resolve({ datadir: new Blob(['dir']), totals: { trees: 1, people: 2, families: 1, media: 0 } })),
}));
const client = vi.hoisted(() => ({
  ensureBackupFolder: vi.fn(() => Promise.resolve('folder')),
  uploadBackup: vi.fn((_t: string, _b: Blob, _f: string, name: string) =>
    Promise.resolve({ id: 'x', name, modifiedTime: '2026-07-17T00:00:00Z', size: '2' })),
  listBackups: vi.fn(() => Promise.resolve([])),
  downloadBackup: vi.fn(() => Promise.resolve(new Blob(['gz']))),
  pruneBackups: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/data/drive/client', () => client);
vi.mock('@/lib/data/drive/auth', () => ({ getToken: vi.fn(() => Promise.resolve('tok')) }));

import { backupToDrive, inspectDriveBackup } from '@/lib/data/drive/backup';
import * as conn from '@/lib/db/connection.pglite';

beforeEach(() => vi.clearAllMocks());

it('uploads a logical .hlbak backup', async () => {
  const file = await backupToDrive();
  expect(conn.dumpDatabaseLogical).toHaveBeenCalledTimes(1);
  expect(file.name).toMatch(/\.hlbak$/);
});

it('prunes older backups only after the new one is verified (#878)', async () => {
  await backupToDrive();
  expect(container.verifyContainer).toHaveBeenCalledTimes(1);
  expect(client.pruneBackups).toHaveBeenCalledTimes(1);
});

it('keeps older backups when the new container does not read back (#878)', async () => {
  container.verifyContainer.mockRejectedValueOnce(new Error('Malformed backup container'));
  await expect(backupToDrive()).rejects.toThrow(/Malformed/);
  expect(client.uploadBackup).not.toHaveBeenCalled();
  expect(client.pruneBackups).not.toHaveBeenCalled();
});

it('keeps older backups when Drive stored a different size (#878)', async () => {
  client.uploadBackup.mockResolvedValueOnce({ id: 'x', name: 'n', modifiedTime: '2026-07-17T00:00:00Z', size: '1' });
  await expect(backupToDrive()).rejects.toThrow(/older backups were kept/);
  expect(client.pruneBackups).not.toHaveBeenCalled();
});

it('inspecting downloads the backup and reads it without restoring (#850)', async () => {
  const result = await inspectDriveBackup('file-1');
  expect(client.downloadBackup).toHaveBeenCalledWith('tok', 'file-1');
  expect(conn.inspectBackupLogical).toHaveBeenCalledTimes(1);
  expect(result.totals.people).toBe(2);
});
