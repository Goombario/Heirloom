/**
 * proves-groups.ts
 *
 * Pure helper — no I/O, no React, no i18n.
 *
 * The rule for a source's "What this source proves" list (#911), shared by the
 * desktop source view and the phone source page (#1181). The query already
 * orders rows by fact date, then person. Below PROVES_GROUP_FROM rows the list
 * stays flat; from there it groups by fact label, groups in label order.
 */

/** From this many facts, the list is grouped by fact type. */
export const PROVES_GROUP_FROM = 8;

/** Rows grouped by their label, keeping row order inside a group, groups sorted by label. */
export function groupProvesRows<R>(rows: R[], labelOf: (row: R) => string, locale: string): [string, R[]][] {
    const byLabel = new Map<string, R[]>();
    for (const row of rows) {
        const label = labelOf(row);
        const group = byLabel.get(label);
        if (group) group.push(row); else byLabel.set(label, [row]);
    }
    return [...byLabel].sort(([a], [b]) => a.localeCompare(b, locale));
}
