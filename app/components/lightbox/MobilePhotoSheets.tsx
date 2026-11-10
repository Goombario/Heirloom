'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MobileRow, cx, fieldClass } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import DateInput from '@/app/components/DateInput';
import { ScanFace, Trash2, UserRound } from '@/lib/icons';

/*
 * The phone photo viewer's small sheets (#1121). Holding a face, or tapping an editor's
 * person row, opens the tag sheet: the person's page, a new face box, someone else on
 * this box, or Remove tag. Edit on the Details sheet opens the light edit sheet.
 */

export function TagSheet({ open, onClose, name, personId, canRemove, onRedraw, onRetag, onRemove }: {
    open: boolean;
    onClose: () => void;
    name: string;
    personId: number;
    canRemove: boolean;
    onRedraw: () => void;
    onRetag: () => void;
    onRemove: () => void;
}) {
    const t = useTranslations('mobilePhoto');
    return (
        <Sheet open={open} onClose={onClose} title={name}>
            <div className="-mx-4">
                <MobileRow icon={<UserRound className="w-[18px] h-[18px]" aria-hidden="true" />} label={t('open_page')} end="leave" href={`/people/view?id=${personId}`} />
                <MobileRow divided icon={<ScanFace className="w-[18px] h-[18px]" aria-hidden="true" />} label={t('redraw_box')} end="chevron" onClick={onRedraw} />
                <MobileRow divided icon={<UserRound className="w-[18px] h-[18px]" aria-hidden="true" />} label={t('tag_someone_else')} end="chevron" onClick={onRetag} />
                {canRemove && (
                    <MobileRow divided tone="danger" icon={<Trash2 className="w-[18px] h-[18px]" aria-hidden="true" />} label={t('remove_tag')} onClick={onRemove} />
                )}
            </div>
        </Sheet>
    );
}

/** Title and date taken; the date field carries its own qualifier chips. */
export function EditPhotoSheet({ open, onClose, title, date, onSave }: {
    open: boolean;
    onClose: () => void;
    title: string;
    date: string;
    onSave: (title: string, date: string) => Promise<boolean>;
}) {
    const t = useTranslations('mobilePhoto');
    const tl = useTranslations('mediaLightbox');
    const ids = useId();
    const [formTitle, setFormTitle] = useState(title);
    const [formDate, setFormDate] = useState(date);
    const [saving, setSaving] = useState(false);

    // A fresh form each time it opens.
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) { setFormTitle(title); setFormDate(date); }
    }

    const dirty = formTitle !== title || formDate !== date;
    const save = async () => {
        setSaving(true);
        const ok = await onSave(formTitle, formDate);
        setSaving(false);
        if (ok) onClose();
    };

    return (
        <Sheet open={open} onClose={onClose} title={t('edit_photo')} size="full" dirty={dirty} onSave={save} saveDisabled={saving}>
            <div className="grid gap-5 pt-1">
                <div className="grid gap-1.5">
                    <label htmlFor={`${ids}-title`} className="text-meta font-semibold text-text-secondary">{tl('title_label')}</label>
                    <input id={`${ids}-title`} value={formTitle} onChange={(e) => setFormTitle(e.target.value)} autoComplete="off" maxLength={500}
                        placeholder={tl('title_placeholder')}
                        className="w-full h-[46px] rounded-[10px] border border-border bg-surface px-3 text-md text-text input-nozoom focus-ring" />
                </div>
                <div className="grid gap-1.5">
                    <label htmlFor={`${ids}-date`} className="text-meta font-semibold text-text-secondary">{tl('date_label')}</label>
                    <DateInput id={`${ids}-date`} value={formDate} onChange={setFormDate} qualifierChips className={cx(fieldClass(), 'min-h-11')} />
                </div>
            </div>
        </Sheet>
    );
}
