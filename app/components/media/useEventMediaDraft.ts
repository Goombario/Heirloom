'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDataClient } from '@/lib/data';
import {
  processEventMediaDraft,
  type EventMediaDraftFailure,
  type EventMediaDraftItem,
  type EventMediaDraftOutcome,
} from './event-media-draft';

export interface EventMediaDraftController {
  items: EventMediaDraftItem[];
  failures: EventMediaDraftFailure[];
  stagedMediaIds: number[];
  addFiles: (files: FileList | readonly File[]) => void;
  addExisting: (mediaIds: readonly number[]) => void;
  remove: (key: string) => void;
  process: (eventId: number, client?: Parameters<typeof processEventMediaDraft>[0]['client']) => Promise<EventMediaDraftOutcome>;
}

interface EventMediaDraftOptions {
  treeId: number | null;
  initialItems?: readonly EventMediaDraftItem[];
  /** A person's life event: new uploads also go in their gallery (#1204). */
  galleryPersonId?: number;
}

function makeIntentId(): string {
  const webCrypto = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();

  // UploadIntentId is validated as a UUID at the API/schema boundary. Keep the
  // fallback equally shaped for older browsers and constrained webviews where
  // randomUUID is unavailable; the item retains this value across retries.
  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === 'function') webCrypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function useEventMediaDraft({ treeId: _treeId, initialItems = [], galleryPersonId }: EventMediaDraftOptions): EventMediaDraftController {
  const [items, setItems] = useState<EventMediaDraftItem[]>(() => [...initialItems]);
  const [failures, setFailures] = useState<EventMediaDraftFailure[]>([]);
  const itemsRef = useRef(items);
  const fileKeys = useRef(new WeakMap<File, string>());
  const sequence = useRef(0);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const addFiles = useCallback((files: FileList | readonly File[]) => {
    const next: EventMediaDraftItem[] = [];
    for (const file of Array.from(files)) {
      let key = fileKeys.current.get(file);
      if (!key) {
        key = `file-${sequence.current++}`;
        fileKeys.current.set(file, key);
      }
      if (itemsRef.current.some(item => item.key === key)) continue;
      next.push({ key, kind: 'file', file, uploadIntentId: makeIntentId() });
    }
    if (next.length === 0) return;
    setItems(prev => [...prev, ...next]);
    setFailures(prev => prev.filter(f => !next.some(item => item.key === f.key)));
  }, []);

  const addExisting = useCallback((mediaIds: readonly number[]) => {
    const staged = new Set(itemsRef.current.flatMap(item => item.kind === 'existing' ? [item.mediaId] : []));
    const next = mediaIds
      .filter(id => Number.isInteger(id) && id > 0 && !staged.has(id))
      .map(mediaId => ({ key: `media-${mediaId}`, kind: 'existing' as const, mediaId }))
      .filter(item => !itemsRef.current.some(existing => existing.key === item.key));
    if (next.length === 0) return;
    setItems(prev => [...prev, ...next]);
  }, []);

  const remove = useCallback((key: string) => {
    setItems(prev => prev.filter(item => item.key !== key));
    setFailures(prev => prev.filter(f => f.key !== key));
  }, []);

  const process = useCallback(async (eventId: number, client?: Parameters<typeof processEventMediaDraft>[0]['client']) => {
    const actualClient = client ?? (await getDataClient()).media;
    const outcome = await processEventMediaDraft({ eventId, treeId: _treeId, items: itemsRef.current, client: actualClient, galleryPersonId });
    const succeeded = new Set(outcome.succeededKeys);
    setItems(prev => prev.filter(item => !succeeded.has(item.key)));
    setFailures(outcome.failed);
    return outcome;
  }, [_treeId, galleryPersonId]);

  return {
    items,
    failures,
    stagedMediaIds: items.filter(item => item.kind === 'existing').map(item => item.mediaId),
    addFiles,
    addExisting,
    remove,
    process,
  };
}
