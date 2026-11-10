import { DATA_MODE } from '@/lib/data';

/**
 * Google Drive manual backup/restore — build-time configuration.
 *
 * The entire feature is gated on a single env var. When it is absent (the
 * default for every fork / self-host), `DRIVE_ENABLED` is false and the Drive
 * UI never renders — the static build keeps working with file backup/restore
 * only, and no Google Cloud setup is required to run the app.
 *
 * Because it is `NEXT_PUBLIC_`, the flag is inlined at build time, so a build
 * without the var can tree-shake the GIS loader and Drive client out entirely.
 */
export const DRIVE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID ?? '';

/** True only in the local/PGlite build AND when an operator has supplied a client ID. */
export const DRIVE_ENABLED = DATA_MODE === 'local' && DRIVE_CLIENT_ID.length > 0;

/** Non-sensitive scope — access limited to files this app creates. No CASA, $0/yr. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Visible folder created in the user's Drive to hold backups. */
export const DRIVE_FOLDER_NAME = 'Heirloom';

/** Retention: keep at most this many backups; older ones are pruned after upload. */
export const DRIVE_BACKUP_LIMIT = 10;

/**
 * appProperties tag stamped on every backup file so we can list only our own
 * backups (belt-and-suspenders on top of `drive.file` app-scoping).
 */
export const BACKUP_TAG_KEY = 'heirloom';
export const BACKUP_TAG_VALUE = 'backup';

/** appProperties value marking a backup's on-disk format, for self-describing listings. */
export const BACKUP_FORMAT = 'logical-v2';

/** Google Drive folder MIME type. */
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
