'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import { NotFoundError } from '@/lib/data/errors';
import { useErrorToast } from '@/app/components/useErrorToast';
import type { Source } from '@/lib/db/queries/sources';
import type { CitedByRow } from '@/lib/db/queries/citations';
import { type SourceFormState, emptySourceForm } from '@/app/components/SourceFields';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sourceToForm(s: Source): SourceFormState {
  return {
    Title: s.Title ?? '',
    Type: s.Type ?? 'Document',
    Author: s.Author ?? '',
    Abbreviation: s.Abbreviation ?? '',
    RepositoryName: s.RepositoryName ?? '',
    CallNumber: s.CallNumber ?? '',
    Text: s.Text ?? '',
    PublicationInfo: s.PublicationInfo ?? '',
    Contents: s.Contents ?? '',
  };
}

/** The save payload: Title trimmed and empty strings as null. Shared with the
 *  phone's source sheet (#1119). */
export function sourceFormPayload(form: SourceFormState) {
  return {
    Title: form.Title.trim(),
    Type: form.Type,
    Author: form.Author || null,
    Abbreviation: form.Abbreviation || null,
    RepositoryName: form.RepositoryName || null,
    CallNumber: form.CallNumber || null,
    Text: form.Text || null,
    PublicationInfo: form.PublicationInfo || null,
    Contents: form.Contents || null,
  };
}

class SupersededSourceEditorOperation extends Error {}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseSourceEditorResult {
  /** The loaded source record, or null in new mode / before load completes. */
  source: Source | null;
  /** Citation cross-references for the loaded source (empty in new mode). */
  citedBy: CitedByRow[];
  /** Current form state. */
  form: SourceFormState;
  /** Merge a partial patch into `form`. */
  setForm: (patch: Partial<SourceFormState>) => void;
  /** True while the source is being loaded from the data client. */
  loading: boolean;
  /** True while a save operation is in flight. */
  saving: boolean;
  /** True while a delete operation is in flight. */
  deleting: boolean;
  /** Last error message, or null. */
  error: string | null;
  /** True when the source/citations read failed; stale source data may remain. */
  loadError: boolean;
  /** True when the current source read has the feature-specific missing-record result. */
  notFound: boolean;
  /** True when `form` differs from the value last loaded or saved. */
  isDirty: boolean;
  /** True when `form.Title` has at least one non-whitespace character. */
  titleValid: boolean;
  /**
   * Persist the current form.
   * - Edit mode: calls `sources.update(sourceId, form, treeId)`.
   * - New mode:  calls `sources.create(form, treeId)`.
   * Returns the saved `Source`.
   */
  save(): Promise<Source>;
  /**
   * Delete the currently loaded source.
   * No-ops when in new mode (`sourceId === null`).
   */
  remove(): Promise<void>;
  /** Re-trigger the load effect (bumps an internal token). */
  reload(): void;
  /** Discard local edits and restore the last loaded/saved form snapshot. */
  discard(): void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages form state and CRUD operations for a single source record.
 * Shared by `SourceModal` (edit flow) and the add route (new flow).
 *
 * @param sourceId  Existing source id to load, or `null` to start a blank form.
 * @param treeId   Shared-tree owner id; `null` means the current user's own tree.
 */
export function useSourceEditor(
  sourceId: number | null,
  treeId: number | null,
): UseSourceEditorResult {
  const [source, setSource] = useState<Source | null>(null);
  const [citedBy, setCitedBy] = useState<CitedByRow[]>([]);
  const [form, setFormState] = useState<SourceFormState>(emptySourceForm);
  // Snapshot of form as it was when last loaded or saved — used for isDirty.
  const [savedForm, setSavedForm] = useState<SourceFormState>(emptySourceForm);
  // Start loading immediately when a sourceId is known; skip for new mode.
  const [loading, setLoading] = useState(sourceId !== null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const resourceKey = `${treeId ?? 'default'}:${sourceId ?? 'new'}`;
  const resourceKeyRef = useRef(resourceKey);
  resourceKeyRef.current = resourceKey;
  const saveGeneration = useRef(0);
  const deleteGeneration = useRef(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(sourceId === null ? resourceKey : null);
  const [loadErrorKey, setLoadErrorKey] = useState<string | null>(null);
  const [notFoundKey, setNotFoundKey] = useState<string | null>(null);
  const t = useTranslations('library');
  const { redirectIfUnauthorized } = useErrorToast();
  // Bump to re-trigger the load effect without changing sourceId.
  const [reloadToken, setReloadToken] = useState(0);

  // ---- Load effect --------------------------------------------------------

  useEffect(() => {
    // A source/tree switch or explicit reload owns a new operation generation.
    // Old save/delete completions may finish on the server for their captured
    // scope, but they must not update or close the replacement editor.
    saveGeneration.current++;
    deleteGeneration.current++;
    setSaving(false);
    setDeleting(false);

    if (sourceId === null) {
      // New mode — reset to blank, nothing to fetch.
      setSource(null);
      setCitedBy([]);
      setFormState(emptySourceForm);
      setSavedForm(emptySourceForm);
      setLoading(false);
      setLoadError(false);
      setLoadErrorKey(null);
      setNotFoundKey(null);
      setLoadedKey(resourceKey);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setLoadError(false);
    setLoadErrorKey(null);
    setNotFoundKey(null);

    void (async () => {
      try {
        const client = await getDataClient();
        const [loadedSource, loadedCitedBy] = await Promise.all([
          client.sources.get(sourceId, treeId),
          client.sources.citedBy(sourceId, treeId),
        ]);
        if (cancelled) return;
        const mapped = sourceToForm(loadedSource);
        setSource(loadedSource);
        setCitedBy(loadedCitedBy);
        setFormState(mapped);
        setSavedForm(mapped);
        setLoadedKey(resourceKey);
      } catch (err) {
        if (cancelled) return;
        if (redirectIfUnauthorized(err)) return;
        if (err instanceof NotFoundError) {
          setNotFoundKey(resourceKey);
          setError(null);
        } else {
          setLoadError(true);
          setLoadErrorKey(resourceKey);
          setError(t('failed_load_source'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sourceId, treeId, resourceKey, reloadToken, redirectIfUnauthorized, t]);

  // ---- Callbacks ----------------------------------------------------------

  const setForm = useCallback((patch: Partial<SourceFormState>) => {
    setFormState(prev => ({ ...prev, ...patch }));
  }, []);

  const notFound = notFoundKey === resourceKey;
  const resourceReady = loadedKey === resourceKey && !notFound;
  const activeForm = resourceReady ? form : emptySourceForm;

  const save = useCallback(async (): Promise<Source> => {
    if (!resourceReady) throw new SupersededSourceEditorOperation();
    const key = resourceKey;
    const generation = ++saveGeneration.current;
    const isCurrent = () => resourceKeyRef.current === key && saveGeneration.current === generation;
    setSaving(true);
    setError(null);
    try {
      const client = await getDataClient();
      if (!isCurrent()) throw new SupersededSourceEditorOperation();
      // Build a normalized payload: trim Title and coerce empty strings to null.
      const payload = sourceFormPayload(activeForm);
      let saved: Source;
      if (sourceId !== null) {
        saved = await client.sources.update(sourceId, payload, treeId);
      } else {
        saved = await client.sources.create(payload, treeId);
      }
      if (!isCurrent()) throw new SupersededSourceEditorOperation();
      const mapped = sourceToForm(saved);
      setSource(saved);
      setFormState(mapped);
      setSavedForm(mapped);
      return saved;
    } catch (err) {
      if (err instanceof SupersededSourceEditorOperation || !isCurrent()) {
        throw new SupersededSourceEditorOperation();
      }
      if (redirectIfUnauthorized(err)) throw err;
      setError(t('failed_save_source'));
      throw err;
    } finally {
      if (isCurrent()) setSaving(false);
    }
  }, [sourceId, treeId, resourceKey, activeForm, resourceReady, redirectIfUnauthorized, t]);

  const remove = useCallback(async (): Promise<void> => {
    if (sourceId === null) return;
    const key = resourceKey;
    const generation = ++deleteGeneration.current;
    const isCurrent = () => resourceKeyRef.current === key && deleteGeneration.current === generation;
    setDeleting(true);
    setError(null);
    try {
      const client = await getDataClient();
      if (!isCurrent()) throw new SupersededSourceEditorOperation();
      await client.sources.remove(sourceId, treeId);
      if (!isCurrent()) throw new SupersededSourceEditorOperation();
    } catch (err) {
      if (err instanceof SupersededSourceEditorOperation || !isCurrent()) return;
      if (redirectIfUnauthorized(err)) return;
      setError(t('failed_delete_source'));
      throw err;
    } finally {
      if (isCurrent()) setDeleting(false);
    }
  }, [sourceId, treeId, resourceKey, redirectIfUnauthorized, t]);

  const reload = useCallback(() => {
    setReloadToken(t => t + 1);
  }, []);

  const discard = useCallback(() => {
    setFormState(savedForm);
    setError(null);
  }, [savedForm]);

  // ---- Derived values -----------------------------------------------------

  const titleValid = resourceReady && activeForm.Title.trim().length > 0;
  const isDirty = resourceReady && JSON.stringify(activeForm) !== JSON.stringify(savedForm);

  return {
    source: resourceReady ? source : null,
    citedBy: resourceReady ? citedBy : [],
    form: activeForm,
    setForm,
    loading: loading || (!resourceReady && loadErrorKey !== resourceKey && !notFound),
    saving,
    deleting,
    error,
    loadError: loadErrorKey === resourceKey && loadError,
    notFound,
    isDirty,
    titleValid,
    save,
    remove,
    reload,
    discard,
  };
}
