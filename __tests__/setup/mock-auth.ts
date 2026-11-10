import { vi } from 'vitest';
import { getTestUserIds } from './test-user-ids';

// Only mock auth for integration tests that import API routes.
// Unit tests for pure functions don't need this mock.
// The mock is configured as a setup file so it's available globally.
//
// vi.mock is hoisted above imports, but the factory only runs lazily when
// something first imports get-user-from-request — by then `getTestUserIds`
// is resolved and globalSetup has written the JSON.
vi.mock('@/lib/auth/get-user-from-request', () => ({
  getUserFromRequest: vi.fn().mockResolvedValue({
    id: getTestUserIds().user1,
    email: 'test@example.com',
    name: 'Test User',
    googleId: 'google-test-123',
  }),
  isDesktopMode: vi.fn().mockReturnValue(false),
}));

vi.mock('@/app/hooks/useDesktopMode', () => ({
  useDesktopMode: vi.fn().mockReturnValue(false),
  useDesktopModeResolved: vi.fn().mockReturnValue(true),
}));
