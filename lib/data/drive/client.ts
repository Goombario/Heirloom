import {
  DRIVE_FOLDER_NAME,
  DRIVE_FOLDER_MIME,
  DRIVE_BACKUP_LIMIT,
  BACKUP_TAG_KEY,
  BACKUP_TAG_VALUE,
  BACKUP_FORMAT,
} from './config';

/**
 * Pure Google Drive REST transport for Heirloom backups.
 *
 * Every function takes an OAuth access token and talks to the Drive v3 API via
 * the global `fetch`. No Google SDK, no browser globals beyond `fetch`/`FormData`
 * — so this module is unit-testable by stubbing `fetch`. Token acquisition and
 * the PGlite dump/load wiring live in `auth.ts` / `backup.ts`.
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export interface DriveFile {
  id: string;
  name: string;
  /** RFC 3339 timestamp, e.g. "2026-07-01T12:34:56.000Z". */
  modifiedTime: string;
  /** Size in bytes, as a string (Drive returns numbers as strings). */
  size?: string;
}

/** Adds the bearer header and turns any non-2xx response into a thrown Error. */
async function driveFetch(token: string, url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google Drive API error ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res;
}

/**
 * Return the id of the `Heirloom` backup folder, creating it at the Drive root
 * if it does not already exist. Idempotent — reuses the first match.
 */
export async function ensureBackupFolder(token: string): Promise<string> {
  const q =
    `mimeType='${DRIVE_FOLDER_MIME}' and name='${DRIVE_FOLDER_NAME}' and trashed=false`;
  const res = await driveFetch(
    token,
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id)')}`,
  );
  const data = (await res.json()) as { files?: { id: string }[] };
  if (data.files && data.files.length > 0) return data.files[0].id;

  const created = await driveFetch(token, `${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: DRIVE_FOLDER_MIME }),
  });
  const folder = (await created.json()) as { id: string };
  return folder.id;
}

/**
 * Upload a backup tar `blob` into the given folder, tagged so we can list only
 * our own backups later. Returns the created file's metadata.
 */
export async function uploadBackup(
  token: string,
  blob: Blob,
  folderId: string,
  name: string,
): Promise<DriveFile> {
  const metadata = {
    name,
    parents: [folderId],
    appProperties: { [BACKUP_TAG_KEY]: BACKUP_TAG_VALUE, backupFormat: BACKUP_FORMAT },
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const res = await driveFetch(
    token,
    `${UPLOAD_API}/files?uploadType=multipart&fields=${encodeURIComponent('id,name,modifiedTime,size')}`,
    { method: 'POST', body: form },
  );
  return (await res.json()) as DriveFile;
}

/** List Heirloom backups in the folder, newest first. */
export async function listBackups(token: string, folderId: string): Promise<DriveFile[]> {
  const q =
    `'${folderId}' in parents and ` +
    `appProperties has { key='${BACKUP_TAG_KEY}' and value='${BACKUP_TAG_VALUE}' } and ` +
    `trashed=false`;
  const res = await driveFetch(
    token,
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}` +
      `&orderBy=${encodeURIComponent('modifiedTime desc')}` +
      `&fields=${encodeURIComponent('files(id,name,modifiedTime,size)')}`,
  );
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

/** Download a backup file's raw bytes as a Blob. */
export async function downloadBackup(token: string, fileId: string): Promise<Blob> {
  const res = await driveFetch(token, `${DRIVE_API}/files/${fileId}?alt=media`);
  return res.blob();
}

/** Permanently delete a backup file. */
export async function deleteBackup(token: string, fileId: string): Promise<void> {
  await driveFetch(token, `${DRIVE_API}/files/${fileId}`, { method: 'DELETE' });
}

/**
 * Pure retention helper: given backup files, return the ids of the ones to
 * delete so that only the newest `keep` remain. Defensively sorts by
 * `modifiedTime` (newest first) rather than trusting input order.
 */
export function selectStaleBackups(files: DriveFile[], keep: number): string[] {
  if (keep < 0) keep = 0;
  return [...files]
    .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))
    .slice(keep)
    .map((f) => f.id);
}

/** List the folder's backups and delete all but the newest `keep`. */
export async function pruneBackups(
  token: string,
  folderId: string,
  keep: number = DRIVE_BACKUP_LIMIT,
): Promise<void> {
  const files = await listBackups(token, folderId);
  const stale = selectStaleBackups(files, keep);
  for (const id of stale) {
    await deleteBackup(token, id);
  }
}
