'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDataClient } from '@/lib/data';
import { useErrorToast } from '@/app/components/useErrorToast';
import type { MediaWithPerson } from '@/lib/db/schema';
import type { MediaOwnerFact, MediaOwnerTable } from '@/lib/db/fact-tables';
import type { MediaPickerSource } from './library';

/** Where the library comes from: the tree's media for an owner, a record's own source, or none. */
export type LibraryScope =
    | { kind: 'owner'; ownerTable: MediaOwnerTable; ownerId?: number; ownerFact?: MediaOwnerFact }
    | { kind: 'source'; source: MediaPickerSource }
    | { kind: 'none' };

/**
 * The library half of Add media (#1204, from the #414 picker): every media row the
 * owner could take, and the ids already attached to it. Each read is keyed to the
 * scope, so a different owner never shows the previous one's rows or errors.
 * `ready` is false until both reads have landed for this scope; nothing may be
 * picked before then, since an unknown attached set could offer a duplicate link.
 */
export function useLibraryCandidates(scope: LibraryScope, treeId: number | null) {
    const scopeKey = scope.kind === 'source'
        ? `source:${scope.source.key}:${treeId ?? 'default'}`
        : scope.kind === 'owner'
            ? `${scope.ownerTable}:${scope.ownerId ?? 'draft'}:${scope.ownerFact ?? ''}:${treeId ?? 'default'}`
            : 'none';
    const source = scope.kind === 'source' ? scope.source : null;
    const ownerTable = scope.kind === 'owner' ? scope.ownerTable : null;
    const ownerId = scope.kind === 'owner' ? scope.ownerId : undefined;
    const ownerFact = scope.kind === 'owner' ? scope.ownerFact : undefined;
    const enabled = scope.kind !== 'none';

    const [media, setMedia] = useState<{ key: string; value: MediaWithPerson[] } | null>(null);
    const [attached, setAttached] = useState<{ key: string; value: Set<number> } | null>(null);
    const [mediaError, setMediaError] = useState<{ key: string; error: unknown } | null>(null);
    const [attachedError, setAttachedError] = useState<{ key: string; error: unknown } | null>(null);
    const mediaGeneration = useRef(0);
    const attachedGeneration = useRef(0);
    const { redirectIfUnauthorized } = useErrorToast();

    const loadMedia = useCallback(async () => {
        if (!enabled) return;
        const generation = ++mediaGeneration.current;
        setMediaError(null);
        try {
            const value = source
                ? await source.loadCandidates()
                : (await (await getDataClient()).media.list<MediaWithPerson>({ treeId, withPerson: true })).media;
            if (generation === mediaGeneration.current) setMedia({ key: scopeKey, value });
        } catch (e) {
            if (redirectIfUnauthorized(e)) return;
            if (generation === mediaGeneration.current) setMediaError({ key: scopeKey, error: e });
        }
    }, [enabled, source, treeId, scopeKey, redirectIfUnauthorized]);

    const loadAttached = useCallback(async () => {
        if (!enabled) return;
        const generation = ++attachedGeneration.current;
        setAttachedError(null);
        try {
            // A source's candidates already leave out what's attached.
            const list = source || ownerId == null || ownerTable == null
                ? []
                : await (await getDataClient()).media.listForOwner(ownerTable, ownerId, treeId, ownerFact);
            if (generation === attachedGeneration.current) setAttached({ key: scopeKey, value: new Set(list.map(m => m.Id)) });
        } catch (e) {
            if (redirectIfUnauthorized(e)) return;
            if (generation === attachedGeneration.current) setAttachedError({ key: scopeKey, error: e });
        }
    }, [enabled, source, ownerTable, ownerId, ownerFact, treeId, scopeKey, redirectIfUnauthorized]);

    useEffect(() => {
        void Promise.resolve().then(() => {
            void loadMedia();
            void loadAttached();
        });
    }, [loadMedia, loadAttached]);

    const visibleMediaError = mediaError?.key === scopeKey ? mediaError.error : null;
    const visibleAttachedError = attachedError?.key === scopeKey ? attachedError.error : null;
    const all = media?.key === scopeKey ? media.value : null;
    const attachedIds = attached?.key === scopeKey && visibleAttachedError == null ? attached.value : null;
    return {
        enabled,
        /** Every candidate, or null while loading or after a failed read. */
        all,
        /** What this owner already has, or null until it is known. */
        attachedIds,
        ready: all != null && attachedIds != null,
        mediaError: visibleMediaError,
        attachedError: visibleAttachedError,
        loadMedia,
        loadAttached,
    };
}
