'use client';

import { useTranslations } from 'next-intl';
import { Button, Card } from '@/app/components/ui';
import { useUpdates } from '@/app/components/updates/UpdateProvider';

/**
 * Options › Updates (#24), in the desktop app only: Check for updates (on by
 * default; off stops the github.com check), Check now and Update now.
 */
export default function UpdatesSection() {
    const t = useTranslations('updates');
    const { desktop, current, available, enabled, setEnabled, checkState, checkNow, openDialog } = useUpdates();
    if (!desktop) return null;
    const status = available ? t('status_available', { current, version: available.version })
        : checkState === 'checking' ? t('status_checking')
        : checkState === 'failed' ? t('status_failed', { current })
        : checkState === 'up_to_date' ? t('status_up_to_date', { current })
        : t('status_current', { current });
    return (
        <Card id="updates" pad={false} className="p-6">
            <h2 className="section text-text mb-1">{t('options_title')}</h2>
            <p className="text-xs text-text-muted mb-4" role="status">{status}</p>
            <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded mt-0.5" />
                <div>
                    <span className="text-sm font-medium text-text">{t('check_label')}</span>
                    <p className="text-xs text-text-muted mt-0.5">{t('check_help')}</p>
                </div>
            </label>
            <div className="flex flex-wrap gap-2 mt-4">
                <Button variant="outline" size="sm" disabled={checkState === 'checking'} onClick={checkNow}>{t('check_now')}</Button>
                {available && <Button variant="primary" size="sm" onClick={openDialog}>{t('update_now')}</Button>}
            </div>
        </Card>
    );
}
