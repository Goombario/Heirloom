import { getLastSeenVersion, setLastSeenVersion } from '@/lib/db/queries/users';
import { ValidationError } from '@/lib/validation';
import { isAppVersion } from '@/lib/whats-new/version';

/**
 * Per-user app state that follows the account, not a tree (#35). Each user
 * reads and writes only their own row, so there is no tree scope here.
 */
export function getLastSeenVersionService(userId: number): Promise<string | null> {
  return getLastSeenVersion(userId);
}

/** Record the version whose What's new the user has now seen. */
export async function setLastSeenVersionService(userId: number, version: unknown): Promise<void> {
  if (!isAppVersion(version)) {
    throw new ValidationError('version must be an app version such as 1.1.0 or 1.1.0-rc.1');
  }
  await setLastSeenVersion(userId, version);
}
