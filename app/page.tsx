'use client';

import { useTree } from '@/app/contexts/TreeContext';
import { PageShell } from '@/app/components/ui';
import { getDataClient } from '@/lib/data';
import { useCachedResource } from '@/app/components/useCachedResource';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import { MobileHome } from '@/app/components/home/MobileHome';
import { DesktopHome } from '@/app/components/home/DesktopHome';

export default function Home() {
    const { activeTreeId, activePermission, currentUserId } = useTree();
    const canEdit = activePermission !== 'view';
    const canRestore = activePermission === 'owner' || activePermission === 'edit';

    // Let failures reject so useCachedResource records the error instead of caching
    // a swallowed null/[] as a successful value (which would stick until a write
    // cleared it). The two reads are already independent hooks, so one failing
    // doesn't sink the other, and a transient failure self-heals on the next mount.
    const dash = useCachedResource(
        currentUserId === null ? null : `dashboard:get:tree=${activeTreeId ?? 'default'}`,
        async () => (await getDataClient()).dashboard.get(activeTreeId),
    );
    const sugg = useCachedResource(
        currentUserId === null ? null : `dashboard:suggestions:tree=${activeTreeId ?? 'default'}`,
        async () => (await getDataClient()).dashboard.suggestions(activeTreeId),
    );
    // Dates to check (#834): the Needs attention count, not the whole list (#1270).
    const checks = useCachedResource(
        currentUserId === null ? null : `dataChecks:summary:tree=${activeTreeId ?? 'default'}`,
        async () => (await getDataClient()).dataChecks.summary(activeTreeId),
    );
    const data = dash.data ?? null;
    const suggestions = sugg.data ?? [];
    const loading = dash.loading || sugg.loading;

    // Skeleton-first (delay 0): the homepage is the hard-reloaded landing page and
    // its dashboard fetch is reliably slow, so show skeletons from the first frame
    // (the prerendered HTML ships them) rather than an empty → skeleton starter phase.
    // Treat "user still resolving" (currentUserId === null before /api/users/me
    // resolves in hosted mode) as loading, so the prerendered HTML ships the
    // skeletons instead of an empty dashboard. (delay 0 = skeleton-first.)
    const phase = useLoadPhase(currentUserId === null || loading, { delay: 0 });

    const datesToCheck = checks.data?.openCount ?? 0;
    const duplicates = suggestions.find(s => s.type === 'duplicates')?.count ?? 0;

    // Phones get their own page (#1061); the desktop column below hides under `md`.
    const phonePage = (
        <MobileHome data={data} phase={phase} datesToCheck={datesToCheck} duplicates={duplicates} canEdit={canEdit} treeId={activeTreeId} />
    );

    return (
        <PageShell topBar={phonePage} contentClassName="max-md:hidden">
            <DesktopHome data={data} phase={phase} datesToCheck={datesToCheck} duplicates={duplicates} canEdit={canEdit} canRestore={canRestore} treeId={activeTreeId} />
        </PageShell>
    );
}
