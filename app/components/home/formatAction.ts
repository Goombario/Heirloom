import type { useTranslations } from 'next-intl';
import { auditFieldSpec, type AuditFieldSpec } from '@/lib/utils/audit-fields';
import { addRemoveActionKey } from '@/lib/utils/activity-groups';

type Translator = ReturnType<typeof useTranslations>;

type FieldDiff = { old: unknown; new: unknown };
type FormatActionChanges = { fields?: Record<string, FieldDiff> } | { snapshot?: Record<string, unknown> } | null | undefined;

/** Readable value for one field, as the audit log shows it (`useAuditFieldFormat().value`). */
export type FormatValue = (spec: AuditFieldSpec, raw: unknown) => string;

/** The person as the row shows them now: for "Renamed from …" and gendered wording. */
export interface CurrentPerson { FirstName?: string | null; LastName?: string | null; Sex?: string | null }

export interface FormatActionOptions { value?: FormatValue; person?: CurrentPerson | null }

const isEmpty = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
const isTrue = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
const NAME_FIELDS = new Set(['FirstName', 'LastName']);
const PLACE_LABELS = new Set(['birth_place', 'death_place', 'place', 'marriage_place']);

/**
 * Which change leads when one edit touched several fields (#209): deceased,
 * then name, then dates, then places, then the rest.
 */
function rank(field: string, s: AuditFieldSpec): number {
    if (field === 'IsDeceased') return 0;
    if (NAME_FIELDS.has(field)) return 1;
    if (s.kind === 'date') return 2;
    if (PLACE_LABELS.has(s.label)) return 3;
    if (s.kind === 'opaque') return 5;
    return 4;
}

function sexKey(sex: string | null | undefined): string {
    return sex === 'F' ? 'F' : sex === 'M' ? 'M' : 'other';
}

/** The previous full name: the old value of each changed part, the current value of the rest. */
function previousName(fields: Record<string, FieldDiff>, person: CurrentPerson | null | undefined): string {
    const part = (f: 'FirstName' | 'LastName') => {
        const v = f in fields ? fields[f].old : person?.[f];
        return isEmpty(v) ? '' : String(v).trim();
    };
    return [part('FirstName'), part('LastName')].filter(Boolean).join(' ');
}

/** One sentence for one field's change, or null when it can't say more than "updated". */
function phrase(field: string, s: AuditFieldSpec, diff: FieldDiff, fields: Record<string, FieldDiff>, t: Translator, tAudit: Translator, opts: FormatActionOptions): string | null {
    const label = tAudit(`field_${s.label}`);
    const value = (raw: unknown) => (opts.value ? opts.value(s, raw) : String(raw));
    if (field === 'IsDeceased') {
        return t(isTrue(diff.new) ? 'change_marked_deceased' : 'change_marked_living', { sex: sexKey(opts.person?.Sex) });
    }
    if (NAME_FIELDS.has(field)) {
        const before = previousName(fields, opts.person);
        if (before) return t('change_renamed', { name: before });
        // A name given where there was none reads like any other set value.
    }
    if (s.kind === 'opaque') return t('change_adjusted', { field: label });
    if (isEmpty(diff.new)) return isEmpty(diff.old) ? null : t('change_removed', { field: label });
    if (s.kind === 'date') {
        return t(isEmpty(diff.old) ? 'change_date_added' : 'change_date_changed', { field: label, value: value(diff.new) });
    }
    return t('change_set', { field: label, value: value(diff.new) });
}

/**
 * A person's last change as one line for the home's Recently edited rows (#209):
 * "Marked as deceased, +2 more", "Birth date changed to 12 Mar 1902",
 * "Renamed from Marie Dupont". Anything it can't phrase falls back to
 * "Birth date, Birthplace updated" with translated labels (#551).
 */
export function formatAction(
    entry: { Action: string; EntityType?: string; Changes?: FormatActionChanges },
    t: Translator,
    tAudit: Translator,
    opts: FormatActionOptions = {},
): string {
    if (entry.Action === 'create' || entry.Action === 'delete') return t(addRemoveActionKey(entry.Action, entry.EntityType));
    const fields = (entry.Changes as { fields?: Record<string, FieldDiff> } | null | undefined)?.fields ?? {};
    // The resume card's last change is always a person's.
    const known = Object.entries(fields)
        .map(([field, diff]) => ({ field, diff, spec: auditFieldSpec(entry.EntityType ?? 'person', field) }))
        .filter((f): f is { field: string; diff: FieldDiff; spec: AuditFieldSpec } => f.spec != null && f.diff != null);
    if (known.length === 0) return t('action_updated');

    // One change per label: first and last name are one rename, the photo focus's three columns one adjustment.
    const groups = new Map<string, typeof known[number]>();
    for (const f of [...known].sort((a, b) => rank(a.field, a.spec) - rank(b.field, b.spec))) {
        const key = NAME_FIELDS.has(f.field) ? 'name' : f.spec.label;
        if (!groups.has(key)) groups.set(key, f);
    }
    const lead = [...groups.values()][0];
    const line = phrase(lead.field, lead.spec, lead.diff, fields, t, tAudit, opts);
    if (line == null) {
        const labels = new Set(known.map((f) => tAudit(`field_${f.spec.label}`)));
        return t('action_fields_updated', { fields: [...labels].join(', ') });
    }
    return groups.size > 1 ? t('change_more', { change: line, count: groups.size - 1 }) : line;
}
