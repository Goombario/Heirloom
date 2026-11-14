import type { AccountClient } from '../types';
import { getLastSeenVersionService, setLastSeenVersionService } from '@/lib/services/account';
import { ensureLocalUser } from '../local-user';

/**
 * Per-user app state backed by in-browser PGlite (#35). It lives on the one
 * local user's row, so it is kept with the rest of this install's data.
 */
export class LocalAccountClient implements AccountClient {
  async getLastSeenVersion(): Promise<string | null> {
    return getLastSeenVersionService(await ensureLocalUser());
  }

  async setLastSeenVersion(version: string): Promise<void> {
    await setLastSeenVersionService(await ensureLocalUser(), version);
  }
}
