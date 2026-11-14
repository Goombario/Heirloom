'use client';

import { useTranslations } from 'next-intl';
import { Button, FormDialog } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';

/**
 * A case form's frame: the desktop's dialog with Cancel and the main action in the
 * footer, or on a phone (#135) a full sheet with Cancel and the copper pill in its
 * header. The form inside is the same.
 */
export function CaseFormFrame({ sheet = false, title, subtitle, dirty = false, busy = false, ready, saveLabel, saveWhenClean = false, onSave, onClose, children }: {
    /** Render as the phone's full sheet. */
    sheet?: boolean;
    title: string;
    subtitle?: string;
    dirty?: boolean;
    busy?: boolean;
    /** The main action can run. */
    ready: boolean;
    saveLabel: string;
    /** The action is live before anything changes (a choice already made). */
    saveWhenClean?: boolean;
    onSave: () => unknown;
    onClose: () => void;
    children: React.ReactNode;
}) {
    const tc = useTranslations('common');
    if (sheet) {
        return (
            <Sheet open onClose={onClose} title={title} size="full" dirty={dirty} onSave={onSave} saveLabel={saveLabel}
                saveDisabled={!ready} saveWhenClean={saveWhenClean}>
                {subtitle && <p className="m-0 -mt-1 mb-3 text-sm text-text-muted break-words">{subtitle}</p>}
                {children}
            </Sheet>
        );
    }
    return (
        <FormDialog open onClose={onClose} title={title} subtitle={subtitle} dirty={dirty} busy={busy}
            footer={(requestClose) => (
                <>
                    <Button variant="outline" onClick={requestClose} disabled={busy}>{tc('cancel')}</Button>
                    <Button onClick={() => { void onSave(); }} disabled={!ready}>{saveLabel}</Button>
                </>
            )}>
            {children}
        </FormDialog>
    );
}
