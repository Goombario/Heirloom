'use client';

import { useTranslations } from 'next-intl';
import { Pencil, ArrowUpRight } from '@/lib/icons';
import { RowAction, RowActions } from '@/app/components/ui';

interface EventRowActionsProps {
    /** Human label of the event, woven into the aria-label (e.g. "occupation"). */
    label: string;
    onEdit: () => void;
    /** Absent ⇒ intrinsic fact (no delete). */
    onDelete?: () => void;
    /**
     * Intrinsic facts (Birth/Death, family Marriage) are derived from profile
     * dates, not Events rows — Edit deep-links to the form (↗) and there's no Delete.
     */
    intrinsic?: boolean;
}

/**
 * Per-row Edit / Delete for timeline events: the collections pattern's
 * `RowActions` (#760) with the event named in each action's accessible name.
 * Colour-blind safe: every control is icon + text label.
 */
export function EventRowActions({ label, onEdit, onDelete, intrinsic }: EventRowActionsProps) {
    const te = useTranslations('eventEdit');
    const tc = useTranslations('common');
    if (intrinsic) {
        return (
            <div className="ev-row-actions">
                <RowAction icon={<Pencil size={13} aria-hidden="true" />} label={tc('edit')} ariaLabel={te('edit_event_named', { event: label })} title={te('edit_on_profile')} onClick={onEdit}>
                    <ArrowUpRight size={11} aria-hidden="true" className="-ml-0.5" style={{ opacity: 0.7 }} />
                </RowAction>
            </div>
        );
    }
    return (
        <RowActions
            editLabel={te('edit_event_named', { event: label })}
            deleteLabel={te('delete_event_named', { event: label })}
            onEdit={onEdit}
            onDelete={onDelete}
        />
    );
}
