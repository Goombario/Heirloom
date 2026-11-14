import type { AccountClient } from '../types';
import { throwForStatus } from './shared';

const ENDPOINT = '/api/users/me/last-seen-version';

/** Per-user app state backed by the hosted REST API (#35). */
export class HttpAccountClient implements AccountClient {
  async getLastSeenVersion(): Promise<string | null> {
    const res = await fetch(ENDPOINT);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { version: string | null }).version;
  }

  async setLastSeenVersion(version: string): Promise<void> {
    const res = await fetch(ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
    });
    if (!res.ok) await throwForStatus(res);
  }
}
