'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import { Button, ScrollArea } from '@/app/components/ui';
import { Plus, X } from '@/lib/icons';
import RepositoriesList from './RepositoriesList';

/**
 * Manage repositories (#1154): what was the Repositories tab, as a dialog over Sources.
 * It lists every repository, including ones no source uses yet, so none becomes
 * unreachable once the tab is gone. A row opens that repository's view of the table.
 */
export default function RepositoriesDialog({
  treeId,
  canEdit,
  refreshKey,
  onOpenRepo,
  onAddRepository,
  onClose,
}: {
  treeId: number | null;
  canEdit: boolean;
  refreshKey: number;
  onOpenRepo: (id: number) => void;
  onAddRepository: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('library');
  const tc = useTranslations('common');
  const titleId = useId();
  return (
    <Modal open onClose={onClose} size="lg" labelledBy={titleId}>
      <div className="bg-card rounded-panel shadow-xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id={titleId} className="title-dialog">{t('repos_dialog_title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:bg-hover-surface transition-colors shrink-0 focus-ring"
            aria-label={tc('close')}
            title={tc('close')}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <RepositoriesList treeId={treeId} onOpenRepo={onOpenRepo} refreshKey={refreshKey} bare />
        </ScrollArea>
        {canEdit && (
          <div className="flex justify-end border-t border-border bg-card-alt px-5 py-3">
            <Button variant="primary" size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={onAddRepository}>
              {t('repo_add')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
