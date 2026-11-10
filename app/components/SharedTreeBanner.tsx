'use client';

import { useTree } from '@/app/contexts/TreeContext';
import { useTranslations } from 'next-intl';
import { useTreeDisplayName } from '@/app/hooks/useTreeDisplayName';

export default function SharedTreeBanner() {
  const { activePermission, activeOwnerEmail, activeOwnerName, activeTreeName } = useTree();
  const t = useTranslations('sharedBanner');
  const treeName = useTreeDisplayName();

  // Only show banner when viewing someone else's tree
  if (activePermission === 'owner' || activePermission === null) {
    return null;
  }

  // Owner identity can be unknown right after a persisted-selection restore —
  // fall back to the tree's name, then a translated generic label.
  const ownerDisplay = activeOwnerName || activeOwnerEmail || treeName(activeTreeName) || t('unknown_owner');
  const permissionText = activePermission === 'edit' ? t('edit_access') : activePermission === 'contribute' ? t('contribute_access') : t('view_only');

  return (
    <div
      className="py-2 px-4 text-center text-sm border-b"
      style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', borderColor: 'var(--border)' }}
    >
      {t('viewing_prefix')} <strong>{ownerDisplay}</strong>{t('viewing_suffix', { permission: permissionText })}
    </div>
  );
}
