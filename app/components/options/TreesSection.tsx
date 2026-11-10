'use client';

import { useRef, useState, useId } from 'react';
import { useTranslations } from 'next-intl';
import { useTreeDisplayName } from '@/app/hooks/useTreeDisplayName';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { getDataClient } from '@/lib/data';
import { useMyTrees } from '@/app/hooks/useMyTrees';
import { useTree } from '@/app/contexts/TreeContext';
import Modal from '@/app/components/Modal';
import { Button, Card, IconButton, Input } from '@/app/components/ui';
import { Pencil, AlertTriangle, Network, Loader2 } from '@/lib/icons';
import type { Tree } from '@/lib/db/schema';

/**
 * Options → Trees: list the user's own trees with inline rename and a
 * guarded (type-the-name) permanent delete. Tree deletion is NOT restorable
 * from the audit log, hence the heavy confirm.
 */
export default function TreesSection() {
  const t = useTranslations('options');
  const tc = useTranslations('common');
  const treeName = useTreeDisplayName();
  const { timestamp } = useTimestamp();
  const { trees, refresh } = useMyTrees();
  const { activeTreeId, switchToDefaultTree } = useTree();

  // Inline rename state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const skipBlurRef = useRef(false);

  // Guarded delete state
  const [deleteTarget, setDeleteTarget] = useState<Tree | null>(null);
  const [typedName, setTypedName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Files a successful delete left on server storage (#945): a soft notice, not an error.
  const [cleanupWarningCount, setCleanupWarningCount] = useState(0);
  const deleteTitleId = useId();

  const onlyTree = trees.length <= 1;

  const formatCreated = (iso: string) => timestamp(iso, 'date');

  function startRename(tree: Tree) {
    setEditingId(tree.Id);
    setEditValue(treeName(tree.Name));
    setRenameError(null);
  }

  function cancelRename() {
    skipBlurRef.current = true;
    setEditingId(null);
    setRenameError(null);
  }

  async function commitRename(tree: Tree) {
    if (renaming) return;
    const name = editValue.trim();
    // Saving the shown name unchanged is not a rename, even when it is the
    // translated default rather than the stored "My Tree".
    if (!name || name === tree.Name || name === treeName(tree.Name)) { setEditingId(null); setRenameError(null); return; }
    setRenaming(true);
    setRenameError(null);
    try {
      const client = await getDataClient();
      await client.trees.rename(tree.Id, name);
      await refresh();
      setEditingId(null);
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : tc('error'));
    } finally {
      setRenaming(false);
    }
  }

  function closeDeleteModal() {
    if (deleting) return;
    setDeleteTarget(null);
    setTypedName('');
    setDeleteError(null);
  }

  async function handleDelete() {
    if (!deleteTarget || deleting || typedName !== treeName(deleteTarget.Name)) return;
    setDeleting(true);
    setDeleteError(null);
    setCleanupWarningCount(0);
    try {
      const client = await getDataClient();
      const { cleanupWarningCount: leftOnDisk } = await client.trees.remove(deleteTarget.Id);
      setCleanupWarningCount(leftOnDisk);
      await refresh();
      if (activeTreeId === deleteTarget.Id) switchToDefaultTree();
      setDeleteTarget(null);
      setTypedName('');
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : tc('error'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card id="trees" pad={false} className="p-6">
      <h2 className="text-lg font-bold serif text-text mb-4">{t('trees_title')}</h2>

      <ul className="divide-y divide-border">
        {trees.map((tree) => (
          <li key={tree.Id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-surface-2 text-text-secondary">
              <Network className="w-[18px] h-[18px]" aria-hidden="true" />
            </span>

            <div className="flex-1 min-w-0">
              {editingId === tree.Id ? (
                <>
                  <Input
                    size="sm"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); skipBlurRef.current = true; commitRename(tree); }
                      else if (e.key === 'Escape') cancelRename();
                    }}
                    onBlur={() => {
                      if (skipBlurRef.current) { skipBlurRef.current = false; return; }
                      commitRename(tree);
                    }}
                    aria-label={t('trees_rename')}
                    disabled={renaming}
                    maxLength={120}
                    autoFocus
                  />
                  {renameError && <p role="alert" className="mt-1 text-xs text-error">{renameError}</p>}
                </>
              ) : (
                <>
                  <p className="serif text-[15px] font-semibold text-text truncate">{treeName(tree.Name)}</p>
                  <p className="text-xs text-text-muted">{t('trees_created', { date: formatCreated(tree.CreatedAt) })}</p>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <IconButton
                onClick={() => startRename(tree)}
                label={t('trees_rename')}
                className="w-11 h-11"
                icon={<Pencil className="w-4 h-4" aria-hidden="true" />}
              />
              {/* Quiet red text, not a 44px fill beside the pencil (CT-3). The last tree
                  can't be deleted: aria-disabled (not disabled) keeps it focusable so
                  the title saying why stays reachable. */}
              <Button
                variant="danger-text"
                size="sm"
                className={onlyTree ? 'opacity-50 cursor-not-allowed hover:no-underline' : ''}
                aria-disabled={onlyTree || undefined}
                title={onlyTree ? t('trees_last_tree_hint') : t('trees_delete')}
                onClick={() => { if (!onlyTree) { setDeleteTarget(tree); setTypedName(''); setDeleteError(null); } }}
              >
                {t('trees_delete')}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {cleanupWarningCount > 0 && (
        <p role="status" className="mt-4 rounded-lg p-3 text-sm bg-warning-bg text-warning-text">
          {t('trees_cleanup_warning', { count: cleanupWarningCount })}
        </p>
      )}

      {/* Guarded delete confirm — deletion is permanent (not audit-restorable). */}
      <Modal open={deleteTarget !== null} onClose={closeDeleteModal} size="sm" disableClose={deleting} labelledBy={deleteTitleId}>
        {deleteTarget && (
          <div className="bg-card rounded-2xl shadow-xl overflow-hidden">
            <div className="p-5 border-b border-border flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-error-bg flex items-center justify-center shrink-0">
                <AlertTriangle className="w-[18px] h-[18px] text-error" aria-hidden="true" />
              </div>
              <h3 id={deleteTitleId} className="serif text-lg font-semibold text-text">{t('trees_delete_confirm_title')}</h3>
            </div>
            <div className="p-5">
              <div role="alert" className="bg-error-bg border-l-[3px] border-error rounded-md p-3 text-sm text-error mb-3">
                {t('trees_delete_confirm_body', { name: treeName(deleteTarget.Name) })}
              </div>
              <p className="text-xs text-text-muted mb-4">{t('trees_delete_export_hint')}</p>
              <Input
                size="sm"
                label={t('trees_delete_type_name')}
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder={treeName(deleteTarget.Name)}
                disabled={deleting}
                autoFocus
              />
              {deleteError && <p role="alert" className="mt-3 text-sm text-error">{deleteError}</p>}
            </div>
            <div className="p-4 border-t border-border bg-card-alt flex justify-end gap-3">
              <Button variant="outline" onClick={closeDeleteModal} disabled={deleting}>
                {tc('cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                className="disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={deleting || typedName !== treeName(deleteTarget.Name)}
                icon={deleting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : undefined}
              >
                {t('trees_delete')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
