'use client';

import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/app/components/ConfirmDialog';

interface ClearDeathConfirmProps {
    /** The status being saved; null closes the dialog. */
    status: 'living' | 'unknown' | null;
    name: string;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Asks before a Living or Unknown save deletes the person's death details
 * (#895). Shared by the hero editor, the person form and the tree sidebar.
 */
export function ClearDeathConfirm({ status, name, onConfirm, onCancel }: ClearDeathConfirmProps) {
    const t = useTranslations('editPerson');
    return (
        <ConfirmDialog
            open={status !== null}
            variant="calm"
            tone="danger"
            title={t('clear_death_title')}
            body={
                <>
                    {t(status === 'unknown' ? 'clear_death_body_unknown' : 'clear_death_body_living', { name })}
                    <div className="mt-2 text-meta text-text-muted">{t('clear_death_kept')}</div>
                </>
            }
            confirmLabel={t('clear_death_confirm')}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    );
}
