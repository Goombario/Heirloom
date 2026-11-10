/**
 * Next.js server start hook. Only the hosted Node server schedules work here:
 * the static build has no server, and the Edge runtime has no file system.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.BUILD_TARGET === 'static') return;
    if (process.env.NODE_ENV === 'test') return;
    const { scheduleOrphanMediaCheck } = await import('@/lib/services/orphan-media-check');
    scheduleOrphanMediaCheck();
}
