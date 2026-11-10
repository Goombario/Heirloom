import type { useTranslations } from 'next-intl';
import { auditFieldSpec } from '@/lib/utils/audit-fields';
import { addRemoveActionKey } from '@/lib/utils/activity-groups';

type Translator = ReturnType<typeof useTranslations>;

type FormatActionChanges = { fields?: Record<string, { old: unknown; new: unknown }> } | { snapshot?: Record<string, unknown> } | null | undefined;

/** "Birth date, Birthplace updated": translated field labels, never column names (#551). */
export function formatAction(entry: { Action: string; EntityType?: string; Changes?: FormatActionChanges }, t: Translator, tAudit: Translator): string {
    if (entry.Action === 'create' || entry.Action === 'delete') return t(addRemoveActionKey(entry.Action, entry.EntityType));
    const fields = (entry.Changes as { fields?: Record<string, { old: unknown; new: unknown }> } | null | undefined)?.fields;
    const labels = new Set<string>();
    for (const field of Object.keys(fields ?? {})) {
        // The resume card's last change is always a person's.
        const spec = auditFieldSpec(entry.EntityType ?? 'person', field);
        if (spec) labels.add(tAudit(`field_${spec.label}`));
    }
    if (labels.size > 0) return t('action_fields_updated', { fields: [...labels].join(', ') });
    return t('action_updated');
}
