import { NextRequest } from 'next/server';
import { getTestUserIds } from './test-user-ids';

// Resolve IDs from the JSON written by globalSetup so tests work against any
// DB (fresh CI Postgres assigns Id=1,2; a dev DB with pre-existing users gives
// the upsert different Ids).
const ids = getTestUserIds();

export const TEST_USER = {
  id: ids.user1,
  email: 'test@example.com',
  name: 'Test User',
  googleId: 'google-test-123',
};

export const TEST_USER_2 = {
  id: ids.user2,
  email: 'other@example.com',
  name: 'Other User',
  googleId: 'google-other-456',
};

/**
 * Create a NextRequest for testing API route handlers.
 */
export function createRequest(
  url: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> }
): NextRequest {
  const { method = 'GET', body, headers = {} } = options ?? {};
  const init: ConstructorParameters<typeof NextRequest>[1] = { method, headers: new Headers(headers) };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Headers).set('Content-Type', 'application/json');
  }
  return new NextRequest(new URL(url, 'http://localhost:3000'), init);
}

/**
 * Parse the JSON body from a NextResponse.
 */
export async function parseResponse<T = unknown>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}
