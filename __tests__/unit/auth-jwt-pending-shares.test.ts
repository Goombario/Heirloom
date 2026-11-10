import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The Node jwt callback applies pending shares (#1228) at sign-in, and only for a
 * verified address. The applying itself is covered in pending-shares.pglite.test.ts.
 */
const captured = vi.hoisted(() => ({ config: null as null | { callbacks: { jwt: (p: unknown) => Promise<Record<string, unknown>> } } }));
const resolveOrCreateUser = vi.hoisted(() => vi.fn());
const applyPendingSharesForUser = vi.hoisted(() => vi.fn());
const getUserSummaryByGoogleId = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({
    default: (config: typeof captured.config) => {
        captured.config = config;
        return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
    },
}));
vi.mock('@/lib/auth/provision', () => ({ resolveOrCreateUser }));
vi.mock('@/lib/auth/membership', () => ({ admitSignIn: vi.fn() }));
vi.mock('@/lib/services/sharing', () => ({ applyPendingSharesForUser }));
vi.mock('@/lib/db/queries/users', () => ({ getUserSummaryByGoogleId }));

await import('@/lib/auth/auth');

const signIn = (emailVerified: unknown) => captured.config!.callbacks.jwt({
    token: {},
    account: { provider: 'google' },
    profile: { sub: 'g-1', email: 'New@example.com', name: 'New', email_verified: emailVerified },
});

describe('jwt callback applies pending shares (#1228)', () => {
    beforeEach(() => {
        resolveOrCreateUser.mockReset().mockResolvedValue({ id: 7, email: 'New@example.com', name: 'New' });
        applyPendingSharesForUser.mockReset().mockResolvedValue(1);
        getUserSummaryByGoogleId.mockReset().mockResolvedValue({ Id: 7, Email: 'New@example.com', Name: 'New' });
    });

    const later = (token: Record<string, unknown>) => captured.config!.callbacks.jwt({ token });

    it('applies them for a verified address at sign-in', async () => {
        const token = await signIn(true);
        expect(token.userId).toBe(7);
        expect(applyPendingSharesForUser).toHaveBeenCalledWith(7, 'New@example.com');
        expect(token.pendingSharesRetry).toBeUndefined();
    });

    it('retries on later requests when sign-in could not apply them', async () => {
        applyPendingSharesForUser.mockResolvedValueOnce(null);
        const token = await signIn(true);
        expect(token.pendingSharesRetry).toBe(true);

        const next = await later(token);
        expect(applyPendingSharesForUser).toHaveBeenLastCalledWith(7, 'New@example.com');
        expect(next.pendingSharesRetry).toBeUndefined();
    });

    it('retries when provisioning failed at sign-in, finding the user by Google id', async () => {
        resolveOrCreateUser.mockRejectedValueOnce(new Error('db down'));
        const token = await signIn(true);
        expect(token.userId).toBeUndefined();
        expect(token.pendingSharesRetry).toBe(true);
        expect(applyPendingSharesForUser).not.toHaveBeenCalled();

        const next = await later(token);
        expect(getUserSummaryByGoogleId).toHaveBeenCalledWith('g-1');
        expect(applyPendingSharesForUser).toHaveBeenCalledWith(7, 'New@example.com');
        expect(next.pendingSharesRetry).toBeUndefined();
    });

    it('leaves them pending when Google has not verified the address', async () => {
        const token = await signIn(false);
        await signIn(undefined);
        await later(token);
        expect(token.pendingSharesRetry).toBeUndefined();
        expect(applyPendingSharesForUser).not.toHaveBeenCalled();
    });

    it('does nothing on a later request with no sign-in', async () => {
        await captured.config!.callbacks.jwt({ token: { userId: 7, googleId: 'g-1' } });
        expect(resolveOrCreateUser).not.toHaveBeenCalled();
        expect(applyPendingSharesForUser).not.toHaveBeenCalled();
    });
});
