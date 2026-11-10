'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { TreeCardLifespan } from '@/app/components/tree/TreeCardLifespan';
import { useTranslations } from 'next-intl';
import { Network, X } from '@/lib/icons';
import type { PersonWithRelations } from '@/lib/db/schema';
import { Badge, Button, MobileRow, fieldClass } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import PersonAvatar from '@/app/components/PersonAvatar';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { getDataClient } from '@/lib/data';
import { countTreeDescendants, type DescendantsTreeNode } from './derive';

interface DescendantsPanelProps {
    person: PersonWithRelations;
    treeId: number | null;
    onClose: () => void;
}

const MAX_DESCENDANT_GENERATIONS = 5;

export function DescendantsPanel({ person, treeId, onClose }: DescendantsPanelProps) {
    const t = useTranslations('personDetail');
    const [tree, setTree] = useState<DescendantsTreeNode | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const isMobile = useIsMobile();

    useEffect(() => {
        let cancelled = false;
        getDataClient()
            .then(client => client.tree.get({ id: person.Id, mode: 'descendants', treeId }))
            .catch(() => null)
            .then(data => {
                if (cancelled || !data?.tree) return;
                setTree(data.tree as DescendantsTreeNode);
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [person.Id, treeId]);

    function matches(node: DescendantsTreeNode): boolean {
        if (!filter.trim()) return true;
        const q = filter.trim().toLowerCase();
        if (node.name.toLowerCase().includes(q)) return true;
        return (node.children ?? []).some(matches);
    }

    function renderNode(node: DescendantsTreeNode, depth: number): React.ReactNode {
        if (depth > MAX_DESCENDANT_GENERATIONS) return null;
        if (!matches(node)) return null;
        const visibleChildren = (node.children ?? []).filter(matches);
        const descendantCount = countTreeDescendants(node);
        return (
            <div key={node.id} className={depth === 0 ? 'ml-0 pl-0' : 'ml-3.5 border-l border-l-[color:var(--border-light)] pl-2.5'}>
                <Link
                    href={`/people/view?id=${node.id}`}
                    style={{ color: 'var(--text)' }}
                    className="hover:bg-card-alt flex items-center justify-between gap-2 py-1.5 px-2 text-sm no-underline rounded-[4px]"
                >
                    <div className="flex-1 min-w-0">
                        <div className={depth === 0 ? 'font-semibold' : 'font-medium'}>{node.name}</div>
                        {node.lifespan && <div className="text-xs"><TreeCardLifespan lifespan={node.lifespan} /></div>}
                    </div>
                    {descendantCount > 0 && (
                        <Badge className="shrink-0" title={t('descendant_count_title', { count: descendantCount })}>
                            +{descendantCount}
                        </Badge>
                    )}
                </Link>
                {depth < MAX_DESCENDANT_GENERATIONS && visibleChildren.length > 0 && (
                    <div className="mt-0.5">
                        {visibleChildren.map(c => renderNode(c, depth + 1))}
                    </div>
                )}
            </div>
        );
    }

    const totalCount = (() => {
        if (!tree) return 0;
        let n = 0;
        const walk = (node: DescendantsTreeNode, d: number) => {
            if (d > MAX_DESCENDANT_GENERATIONS) return;
            n += d > 0 ? 1 : 0;
            for (const c of node.children ?? []) walk(c, d + 1);
        };
        walk(tree, 0);
        return n;
    })();

    if (isMobile) {
        // A full-height sheet on a phone (#1122): the fixed 380px side panel was wider than some phones.
        const rows: React.ReactNode[] = [];
        const walk = (node: DescendantsTreeNode, depth: number) => {
            if (depth > MAX_DESCENDANT_GENERATIONS || !matches(node)) return;
            const count = countTreeDescendants(node);
            rows.push(
                <li key={node.id}>
                    <Link href={`/people/view?id=${node.id}`}
                        className="flex items-center gap-2.5 min-h-[54px] py-2 pl-3 pr-4 no-underline text-inherit active:bg-surface-2 focus-ring-inset">
                        <span aria-hidden="true" className="flex self-stretch shrink-0">
                            {Array.from({ length: depth - 1 }, (_, i) => (
                                <i key={i} className="relative w-5 before:absolute before:left-[9px] before:-top-2 before:-bottom-2 before:w-px before:bg-border before:content-['']" />
                            ))}
                        </span>
                        <PersonAvatar as="span" size={36} name={node.name} treeId={treeId}
                            initials={node.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()} />
                        <span className="flex-1 min-w-0 grid gap-px">
                            <span className="serif text-md font-semibold truncate">{node.name}</span>
                            {node.lifespan && <span className="text-meta"><TreeCardLifespan lifespan={node.lifespan} /></span>}
                        </span>
                        {count > 0 && <span className="shrink-0 font-mono text-meta text-text-muted" title={t('descendant_count_title', { count })}>+{count}</span>}
                    </Link>
                </li>,
            );
            for (const c of node.children ?? []) walk(c, depth + 1);
        };
        for (const c of tree?.children ?? []) walk(c, 1);
        return (
            <Sheet open onClose={onClose} title={t('descendants_of', { name: person.FirstName ?? '—' })} size="full">
                <div className="-mx-4 -mt-3">
                    <div className="px-4 pt-3 pb-1">
                        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('filter_by_name')} aria-label={t('filter_by_name')}
                            autoComplete="off" className="w-full h-11 rounded-full border border-border bg-surface px-4 text-md text-text placeholder:text-text-muted input-nozoom focus-ring" />
                    </div>
                    <p className="m-0 px-4 pt-0.5 pb-2 text-meta text-text-muted">
                        {loading ? t('loading_lower') : t('descendants_summary', { count: totalCount, max: MAX_DESCENDANT_GENERATIONS })}
                    </p>
                    {loading ? null : rows.length === 0
                        ? <p className="m-0 px-4 py-6 text-center text-sm text-text-muted">{tree && (tree.children ?? []).length > 0 ? t('descendants_no_match') : t('no_descendants')}</p>
                        : <ul className="m-0 p-0 list-none">{rows}</ul>}
                    <div className="mt-2 border-t border-border">
                        <MobileRow icon={<Network aria-hidden="true" />} label={t('open_as_tree_row')} end="leave" href={`/tree?rootId=${person.Id}`} />
                    </div>
                </div>
            </Sheet>
        );
    }

    return (
        <div className="fixed top-14 right-0 bottom-0 w-[380px] bg-card border-l border-border shadow-[-4px_0_16px_rgba(0,0,0,0.04)] flex flex-col z-30">
            <div className="py-3.5 px-4 border-b border-b-[color:var(--border)] flex items-center justify-between">
                <div>
                    <div className="serif text-md font-semibold">{t('descendants_of', { name: person.FirstName ?? '—' })}</div>
                    <div className="muted text-xs">
                        {loading ? t('loading_lower') : t('descendants_summary', { count: totalCount, max: MAX_DESCENDANT_GENERATIONS })}
                    </div>
                </div>
                <Button variant="ghost" onClick={onClose} aria-label={t('close_descendants')} style={{ padding: 6 }}>
                    <X className="w-4 h-4" aria-hidden="true" />
                </Button>
            </div>

            <div className="py-2.5 px-3.5 border-b border-b-[color:var(--border)]">
                <input
                    type="text"
                    className={fieldClass('sm')}
                    placeholder={t('filter_by_name')}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    style={{ width: '100%' }}
                />
            </div>

            <div className="flex-1 overflow-auto py-2 px-3">
                {loading ? (
                    <div className="muted py-6 px-4 text-center text-sm">{t('loading_descendants')}</div>
                ) : !tree || (tree.children ?? []).length === 0 ? (
                    <div className="muted py-6 px-4 text-center text-sm">
                        {t('no_descendants')}
                    </div>
                ) : (
                    <>
                        {(tree.children ?? []).map(c => renderNode(c, 1))}
                    </>
                )}
            </div>

            <div className="py-2.5 px-4 border-t border-t-[color:var(--border)] text-xs flex justify-between">
                <span className="muted">{t('click_to_open')}</span>
                <Link href={`/tree?rootId=${person.Id}`} className="no-underline text-link hover:underline">{t('open_as_tree')}</Link>
            </div>
        </div>
    );
}
