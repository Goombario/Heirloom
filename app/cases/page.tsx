'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTree } from '@/app/contexts/TreeContext';
import type { CaseWithRelations } from '@/lib/db/schema';
import { parseDate } from './_utils';
import { PageShell } from '@/app/components/ui';
import { useDebounce } from '@/app/hooks/useDebounce';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { MobileCases } from './MobileCases';
import { DesktopCases } from './DesktopCases';

type StatusFilter = 'in_progress' | 'on_hold' | 'closed' | '';

export default function CasesPage() {
    const router = useRouter();
    const { activeTreeId, activePermission, currentUserId } = useTree();
    const treeKey = activeTreeId == null ? 'default' : String(activeTreeId);
    const [cases, setCases] = useState<CaseWithRelations[]>([]);
    const [casesTreeKey, setCasesTreeKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadErrorTreeKey, setLoadErrorTreeKey] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('in_progress');
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 300);
    const [tagFilter, setTagFilter] = useState('');
    const [allTags, setAllTags] = useState<string[]>([]);
    const requestIdRef = useRef(0);
    const { redirectIfUnauthorized } = useErrorToast();

    const t = useTranslations('cases');
    const isMobile = useIsMobile();

    const fetchCases = useCallback(async () => {
        if (currentUserId === null) return;
        const requestId = ++requestIdRef.current;
        const isCurrent = () => requestIdRef.current === requestId;
        setLoading(true);
        setLoadError(null);
        setLoadErrorTreeKey(null);
        try {
            // Fetch all (no status filter on server) so we can show counts and the Closed Recently section.
            const client = await getDataClient();
            if (!isCurrent()) return;
            const { cases: fetched } = await client.cases.list({
                treeId: activeTreeId,
                search: debouncedSearch || undefined,
                tag: tagFilter || undefined,
            });
            if (!isCurrent()) return;
            setCases(fetched);
            setCasesTreeKey(treeKey);
            const tagSet = new Set<string>();
            fetched.forEach(c => c.Tags?.forEach(tag => tagSet.add(tag)));
            setAllTags(Array.from(tagSet).sort());
        } catch (err) {
            if (!isCurrent()) return;
            if (redirectIfUnauthorized(err)) return;
            console.error('Failed to fetch cases:', err);
            setLoadError(t('load_error'));
            setLoadErrorTreeKey(treeKey);
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [activeTreeId, currentUserId, debouncedSearch, tagFilter, redirectIfUnauthorized, t, treeKey]);

    useEffect(() => { fetchCases(); }, [fetchCases]);
    useDocumentTitle(t('title'));

    const canEdit = activePermission !== 'view';
    // delay: 0 — skeleton-first. The default 200ms `pending` window renders null, so a
    // hard reload painted blank → skeleton → data. See the same opt-in on the dashboard,
    // People, Families and Places.
    // Keep a previously loaded list visible while a filter/search revalidation is
    // in flight. A skeleton is reserved for the cold load where there is no
    // stale content to anchor the page.
    const currentCases = useMemo(() => casesTreeKey === treeKey ? cases : [], [casesTreeKey, treeKey, cases]);
    const currentTags = casesTreeKey === treeKey ? allTags : [];
    const currentLoadError = loadErrorTreeKey === treeKey ? loadError : null;
    const phase = useLoadPhase(currentUserId === null || ((loading || (casesTreeKey !== treeKey && !currentLoadError)) && currentCases.length === 0), { delay: 0 });

    const counts = useMemo(() => ({
        inProgress: currentCases.filter(c => c.Status === 'in_progress').length,
        onHold: currentCases.filter(c => c.Status === 'on_hold').length,
        closed: currentCases.filter(c => c.Status === 'closed').length,
        all: currentCases.length,
    }), [currentCases]);

    // A search or tag narrows the list; the status chip alone doesn't when nothing
    // is open, so a tree whose cases are all closed says so plainly (#801, CS-3).
    const narrowed = search.trim() !== '' || debouncedSearch !== '' || tagFilter !== '';
    const openCount = counts.inProgress + counts.onHold;

    const visibleCases = useMemo(() => {
        if (statusFilter === '') return currentCases.filter(c => c.Status !== 'closed');
        return currentCases.filter(c => c.Status === statusFilter);
    }, [currentCases, statusFilter]);

    const closedRecent = useMemo(() => {
        return currentCases
            .filter(c => c.Status === 'closed')
            .sort((a, b) => parseDate(b.UpdatedAt).getTime() - parseDate(a.UpdatedAt).getTime())
            .slice(0, 4);
    }, [currentCases]);

    if (isMobile) {
        return (
            <MobileCases
                treeId={activeTreeId}
                phase={phase}
                loadError={currentLoadError}
                onRetry={fetchCases}
                canEdit={canEdit}
                search={search}
                onSearch={setSearch}
                statusFilter={statusFilter}
                onStatus={setStatusFilter}
                tagFilter={tagFilter}
                onTag={setTagFilter}
                tags={currentTags}
                counts={counts}
                visible={visibleCases}
                closedRecent={closedRecent}
                filtered={narrowed || statusFilter === 'closed' || (statusFilter !== '' && openCount > 0)}
                total={currentCases.length}
                onClearFilters={() => { setSearch(''); setTagFilter(''); setStatusFilter(''); }}
            />
        );
    }

    return (
        <PageShell>
            <DesktopCases
                cases={currentCases}
                loading={phase !== 'ready'}
                loadError={currentLoadError}
                onRetry={fetchCases}
                // activePermission starts null, which canEdit reads as editable.
                canEdit={activePermission !== null && canEdit}
                onNewCase={() => router.push('/cases/new')}
                search={search}
                onSearch={setSearch}
                tag={tagFilter}
                onTag={setTagFilter}
                tags={currentTags}
                treeId={activeTreeId}
            />
        </PageShell>
    );
}
