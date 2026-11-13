'use client';

import React, { useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { AuditLogEntryWithUser } from '@/lib/db/schema';
import type { AuditListResult, AuditRecordKind } from '@/lib/data/types';
import { recordHref } from './entityRoutes';

type Records = AuditListResult['records'];

export const EMPTY_AUDIT_RECORDS: Records = {};

/** An audit entry's Record cell: one line naming what changed and whose it is. */
export interface AuditRecordText {
    /** The line as plain text, for sort dividers and confirm sheets. */
    name: string;
    /** The line with each name bold; names link to their pages when `links` is set. */
    node: (links: boolean) => React.ReactNode;
    /** The page of the record the change belongs to, while it is in the tree. */
    href: string | null;
    /** The record is gone. */
    gone: boolean;
}

/** A name in the line: who or what it is, and where it links while it exists. */
interface NameRef { text: string; href: string | null; gone: boolean; known: boolean }

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/**
 * The Record column for an audit entry (#930): one line that names what changed
 * and the record it belongs to, "Ember Bracken as child of Tom Bracken & Mary
 * Bracken", worded from the list's `records` in the reader's language. A name
 * links to its page while it is in the tree; a deleted one keeps the name its
 * entry saved, with a "deleted" tag.
 */
export function useAuditRecord(records: Records = EMPTY_AUDIT_RECORDS) {
    const t = useTranslations('audit');
    const tEventTypes = useTranslations('eventTypes');
    const tPerson = useTranslations('editPerson');
    const tChecks = useTranslations('dataChecks');

    const eventType = useCallback((code: string | null) => (code ? (tEventTypes.has(code) ? tEventTypes(code) : code) : t('filter_event')), [t, tEventTypes]);

    return useCallback((entry: AuditLogEntryWithUser): AuditRecordText => {
        const record = records[entry.Id];
        if (!record) {
            // An entry the server sent no record for: its saved label is all there is.
            const label = entry.EntityLabel || `#${entry.EntityId}`;
            return { name: label, node: () => <span className="font-semibold">{label}</span>, href: null, gone: false };
        }
        const ref = (kind: AuditRecordKind | null, name: string | null, live: boolean, href: string | null): NameRef => ({
            text: name ?? (kind && kind !== 'tree' ? t(`record_gone_${kind}`) : t('record_gone')),
            href: live ? href : null,
            gone: !live && name != null && kind !== 'tree',
            known: name != null,
        });
        const main = ref(record.kind, record.name, record.live, recordHref(record));
        let child: NameRef | null = null;
        let key = 'rec_own';
        const values: Record<string, string> = {};
        const item = record.item;
        switch (item?.kind) {
            case 'event':
                key = 'rec_event';
                values.event = eventType(item.code);
                break;
            case 'citation': {
                const onRecord = !item.eventCode && (item.fact === 'person' || item.fact === 'case' || item.fact === 'journal' || !item.fact);
                key = `${onRecord ? 'rec_citation_record' : 'rec_citation'}${item.source ? '' : '_nosource'}`;
                if (!onRecord) values.fact = capitalize(item.eventCode ? eventType(item.eventCode) : t(`fact_${item.fact}`));
                if (item.source) values.source = item.source;
                break;
            }
            case 'photoTag':
                key = item.photo ? 'rec_photo_tag' : 'rec_photo_tag_nophoto';
                if (item.photo) values.photo = item.photo;
                break;
            case 'profilePicture':
                key = 'rec_profile_picture';
                break;
            case 'familyPhoto':
                key = 'rec_family_photo';
                break;
            case 'child':
                key = item.name ? 'rec_child' : 'rec_child_unnamed';
                child = ref('person', item.name, item.live, item.id == null ? null : recordHref({ kind: 'person', id: item.id, name: item.name, live: item.live, item: null }));
                break;
            case 'nameVariant': {
                const typeKey = item.type ? `variant_${item.type.toLowerCase()}` : null;
                key = 'rec_name_variant';
                values.type = typeKey && tPerson.has(typeKey) ? tPerson(typeKey) : item.type ?? t('filter_namevariant');
                values.name = item.name ?? '';
                break;
            }
            case 'note':
                key = 'rec_note';
                break;
            case 'journalEntry':
                key = 'rec_journal_entry';
                break;
            case 'story':
                key = 'rec_story';
                values.title = item.title ?? '';
                break;
            case 'dataCheck': {
                const ruleKey = item.rule ? `rule_${item.rule}` : null;
                key = 'rec_data_check';
                values.check = ruleKey && tChecks.has(ruleKey) ? tChecks(ruleKey, { threshold: item.threshold ?? 0, age: item.threshold ?? 0 }) : t('filter_datacheck');
                break;
            }
        }
        if (record.kind === 'tree') key = 'rec_import';
        values.record = key === 'rec_own' ? capitalize(main.text) : main.text;
        if (child) values.child = child.text;

        const name = t.markup(key, { ...values, r: (c) => c, c: (c) => c, b: (c) => c, i: (c) => c });
        const node = (links: boolean) => {
            const show = (n: NameRef, chunks: React.ReactNode) => {
                const inner = <span className={n.known ? 'font-semibold' : undefined}>{chunks}</span>;
                return (
                    <>
                        {links && n.href
                            ? <Link href={n.href} className="hover:underline" style={{ color: 'var(--text)' }}>{inner}</Link>
                            : <span style={{ color: n.gone || !n.known ? 'var(--text-muted)' : 'var(--text)' }}>{inner}</span>}
                        {n.gone && <span className="ml-1 inline-block align-[1px] rounded-full border border-[color:var(--border)] px-1.5 text-xs font-medium leading-[16px]" style={{ color: 'var(--text-2)' }}>{t('tag_deleted')}</span>}
                    </>
                );
            };
            return t.rich(key, {
                ...values,
                r: (chunks) => show(main, chunks),
                c: (chunks) => (child ? show(child, chunks) : chunks),
                b: (chunks) => <span className="font-semibold" style={{ color: 'var(--text)' }}>{chunks}</span>,
                i: (chunks) => <em style={{ color: 'var(--text)' }}>{chunks}</em>,
            });
        };
        return { name, node, href: main.href, gone: !record.live && record.kind !== 'tree' };
    }, [records, eventType, t, tPerson, tChecks]);
}

/**
 * What happened, for entries whose Record used to carry a sentence (#930): a
 * place rename or merge, the marker a revert leaves, a GEDCOM import and a
 * profile picture change. They read in the Changes column instead; other
 * entries return null and show their field changes.
 */
export function useAuditDescription() {
    const t = useTranslations('audit');
    return useCallback((entry: AuditLogEntryWithUser): string | null => {
        const changes = (entry.Changes ?? {}) as { snapshot?: Record<string, unknown>; fields?: Record<string, { old: unknown; new: unknown }>; summary?: { kind?: unknown } };
        const snap = changes.snapshot ?? {};
        const count = (v: unknown) => (typeof v === 'number' ? v : 0);
        if (entry.EntityType === 'place' && entry.Action === 'delete' && snap.deleted === true && typeof snap.name === 'string') {
            return t('summary_place_deleted', { place: snap.name });
        }
        if (entry.EntityType === 'place' && entry.Action === 'update') {
            if (snap.revertOf != null) return t('summary_place_reverted');
            if (snap.names === true && typeof snap.place === 'string') {
                const listed = (v: unknown, pick: (x: Record<string, unknown>) => unknown) =>
                    (Array.isArray(v) ? v : []).map((x) => pick((x ?? {}) as Record<string, unknown>)).filter((n): n is string => typeof n === 'string').join(', ');
                const added = listed(snap.added, (x) => x.name);
                const changed = listed(snap.changed, (x) => (x.after as { name?: unknown } | undefined)?.name);
                const removed = listed(snap.removed, (x) => (x.before as { name?: unknown } | undefined)?.name);
                const parts = [
                    added && t('summary_names_added', { names: added }),
                    changed && t('summary_names_changed', { names: changed }),
                    removed && t('summary_names_removed', { names: removed }),
                ].filter(Boolean);
                return `${t('summary_place_names', { place: snap.place })} · ${parts.join('; ')}`;
            }
            if (snap.move === true && typeof snap.from === 'string' && typeof snap.to === 'string') {
                const records = t('summary_records', { count: Array.isArray(snap.affected) ? snap.affected.length : 0 });
                return `${t('summary_place_moved', { from: snap.from, to: snap.to })} · ${records}`;
            }
            if (typeof snap.from === 'string' && typeof snap.to === 'string') {
                const records = t('summary_records', { count: Array.isArray(snap.affected) ? snap.affected.length : 0 });
                return `${t(snap.wasMerge ? 'summary_place_merged' : 'summary_place_renamed', { from: snap.from, to: snap.to })} · ${records}`;
            }
        }
        // A journal entry struck out or its strike undone (#1251).
        if (entry.EntityType === 'casenote' && typeof snap.struck === 'boolean') {
            if (!snap.struck) return t('summary_entry_unstruck');
            return typeof snap.StruckReason === 'string' && snap.StruckReason
                ? t('summary_entry_struck_reason', { reason: snap.StruckReason })
                : t('summary_entry_struck');
        }
        if (entry.EntityType === 'import') {
            const parts = [t('summary_import_people', { count: count(snap.people) }), t('summary_import_families', { count: count(snap.families) })];
            if (typeof snap.sources === 'number') parts.push(t('summary_import_sources', { count: snap.sources }));
            return `${t(snap.mode === 'overwrite' ? 'summary_import_overwrite' : 'summary_import_merge')} · ${parts.join(', ')}`;
        }
        if (changes.summary?.kind === 'canonical_primary') {
            return t(changes.fields?.CanonicalPrimaryMediaId?.new == null ? 'summary_profile_removed' : 'summary_profile_set');
        }
        if (changes.summary?.kind === 'family_photo') {
            return t(changes.fields?.FamilyPhotoMediaId?.new == null ? 'summary_family_photo_removed' : 'summary_family_photo_set');
        }
        return null;
    }, [t]);
}
