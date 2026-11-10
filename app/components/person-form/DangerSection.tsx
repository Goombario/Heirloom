'use client';

import { useTranslations } from 'next-intl';
import { Button, Card } from '@/app/components/ui';
import { Trash2 } from '@/lib/icons';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import type { UsePersonForm } from '@/app/components/person-form/usePersonForm';

/**
 * DangerSection (edit-mode) — delete-person card wired to the shared ConfirmDialog.
 *
 * Structural extraction from PersonForm.tsx (Task 4). The Final mobile skin
 * (`mobile`) wraps in a `ui/Card` with a red rule and pairs the Delete control
 * with the Trash2 icon (colorblind-safe). The desktop path is untouched.
 */
export default function DangerSection({ fm, personName, mobile = false }: { fm: UsePersonForm; personName: string; mobile?: boolean }) {
    const t = useTranslations('editPerson');
    const tc = useTranslations('common');
    const { deleting, remove, showDeleteConfirm, setShowDeleteConfirm } = fm;

    const body = (
        <div className="row gap-2.5" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
                <div className="font-medium text-sm" style={{ color: 'var(--error)' }}>{t('delete_person')}</div>
                <div className="muted text-meta mt-0.5">{t('delete_desc', { name: personName })}</div>
            </div>
            <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(true)}
                icon={mobile ? <Trash2 size={14} aria-hidden="true" /> : undefined}
                style={{ background: 'var(--card)', color: 'var(--error)', borderColor: 'var(--error)', ...(mobile ? { minHeight: 44, flexShrink: 0 } : null) }}
            >
                {tc('delete')}…
            </Button>
        </div>
    );

    return (
        <>
            {mobile ? (
                <Card className="mb-3" style={{ borderColor: 'var(--error)' }}>{body}</Card>
            ) : (
                <div className="card card-pad mb-[22px] py-3.5 px-4" style={{ borderColor: 'var(--error)' }}>{body}</div>
            )}

            <ConfirmDialog
                open={showDeleteConfirm}
                variant="calm"
                tone="danger"
                title={t('delete_person')}
                body={t('delete_confirm', { name: personName })}
                confirmLabel={tc('yes_delete')}
                busy={deleting}
                onConfirm={remove}
                onCancel={() => setShowDeleteConfirm(false)}
            />
        </>
    );
}
