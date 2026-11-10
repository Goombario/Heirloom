'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Card, EmptyState, InlineDataError } from '@/app/components/ui';
import { ChevronRight } from '@/lib/icons';
import { getDataClient } from '@/lib/data';
import { errorToastKey } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import type { RepositoryWithCount } from '@/lib/data/types';

interface RepositoriesListProps {
    treeId: number | null;
    /** Open a repository's detail modal (URL-driven via `?repo=` on the page). */
    onOpenRepo: (id: number) => void;
    /** Bump to force a reload (e.g. after a repository was renamed/deleted). */
    refreshKey?: number;
    /** Inside the Manage repositories dialog the rows sit straight on the dialog, not in a card. */
    bare?: boolean;
}

/**
 * Manage repositories (#1154; a Library tab until #444) — a management list of the `Repository` entities (archives that
 * hold sources). Each row opens a detail modal (rendered by the page, keyed on the
 * `?repo=` URL param) to rename, edit the address, view the sources held, or delete.
 */
export default function RepositoriesList({ treeId, onOpenRepo, refreshKey = 0, bare = false }: RepositoriesListProps) {
    const t = useTranslations('library');
    const scopeKey = String(treeId ?? 'default');
    const [repos, setRepos] = useState<RepositoryWithCount[] | null>(null);
    const [reposKey, setReposKey] = useState(scopeKey);
    const [error, setError] = useState<unknown>(null);
    const [errorKey, setErrorKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const requestGeneration = useRef(0);
    const tc = useTranslations('common');
    const { redirectIfUnauthorized } = useErrorToast();

    const load = useCallback(async () => {
        const generation = ++requestGeneration.current;
        setLoading(true);
        setError(null);
        setErrorKey(null);
        try {
            const client = await getDataClient();
            const loaded = await client.repositories.list(treeId);
            if (generation !== requestGeneration.current) return;
            setRepos(loaded);
            setReposKey(scopeKey);
        } catch (e) {
            if (redirectIfUnauthorized(e)) return;
            if (generation === requestGeneration.current) {
                setError(e);
                setErrorKey(scopeKey);
            }
        } finally {
            if (generation === requestGeneration.current) setLoading(false);
        }
    }, [treeId, redirectIfUnauthorized, scopeKey]);

    useEffect(() => { load(); }, [load, refreshKey]);

    const visibleRepos = reposKey === scopeKey ? repos : null;
    if (loading && visibleRepos === null) return null;
    const visibleError = errorKey === scopeKey ? error : null;
    const errorBanner = visibleError ? (
        <InlineDataError
            className="mb-3"
            message={String(tc(errorToastKey(visibleError)))}
            retryLabel={String(tc('retry'))}
            onRetry={load}
        />
    ) : null;
    if (visibleRepos === null) {
        return errorBanner;
    }
    if (visibleRepos.length === 0) {
        return visibleError ? errorBanner : <EmptyState variant="empty" message={t('empty_no_repos')} />;
    }

    const rows = (
        <>
            {visibleRepos.map((r, i) => (
                <button
                    key={r.Id}
                    type="button"
                    onClick={() => onOpenRepo(r.Id)}
                    style={{
                        width: '100%', textAlign: 'left', background: 'none', border: 'none',
                        cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center',
                    }}
                    className={`py-3 px-4 gap-3 hover:bg-[color:var(--color-hover-surface)] ${i < visibleRepos.length - 1 ? 'border-b border-b-[color:var(--border-light)]' : ''}`}
                >
                    <div className="flex-1" style={{ minWidth: 0 }}>
                        <div className="serif text-[15px] font-semibold" style={{ color: 'var(--text)' }}>{r.Name}</div>
                        <div className="muted text-meta mt-0.5">
                            {r.Address?.trim() ? r.Address : t('repo_no_address')}
                        </div>
                    </div>
                    <span className="muted text-meta" style={{ whiteSpace: 'nowrap' }}>{t('source_count', { count: r.SourceCount })}</span>
                    <ChevronRight className="w-4 h-4 text-text-muted" aria-hidden="true" />
                </button>
            ))}
        </>
    );
    return (
        <>
            {errorBanner}
            {bare ? rows : <Card style={{ padding: 0, overflow: 'hidden' }}>{rows}</Card>}
        </>
    );
}
