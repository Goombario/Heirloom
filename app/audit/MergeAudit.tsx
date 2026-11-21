'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AuditLogEntry } from '@/lib/db/schema';
import { getDataClient } from '@/lib/data';
import { formatDateForDisplay } from '@/lib/date-utils';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import type { MergeLogView } from '@/app/components/person-merge/model';

/*
 * A person merge in the Audit log (#28, ADR 0052): what was kept, the values not
 * kept, the new alternate name, what moved, what was combined and what was removed;
 * and, before a revert, the later changes that are undone first.
 */

const MOVED = ['events', 'citations', 'names', 'notes', 'photos', 'faceTags', 'cases', 'families', 'childLinks'] as const;
const COMBINED = ['childLinks', 'photos', 'notes', 'faceTags', 'cases'] as const;
const SEX = new Set(['M', 'F', 'X']);

/** "Sex Unknown, Living, Birth about 1850 in Uppsala, Sweden". */
function useNotKeptText() {
  const t = useTranslations('audit');
  const tm = useTranslations('personMerge');
  const { language } = useLanguage();
  const words = useDateQualifierWords();
  return (log: MergeLogView): string => {
    const parts: string[] = [];
    const nk = log.notKept;
    if (nk.name) {
      const name = [nk.name.FirstName, nk.name.LastName].filter((v) => typeof v === 'string' && v.trim()).join(' ');
      parts.push(t('merge_value_name', { value: name || t('merge_value_none') }));
    }
    if (nk.sex) {
      const sex = typeof nk.sex.Sex === 'string' && SEX.has(nk.sex.Sex) ? nk.sex.Sex : 'unknown';
      parts.push(t('merge_value_sex', { value: tm(`sex_${sex}`) }));
    }
    if (nk.living) {
      const v = nk.living.IsDeceased;
      parts.push(v === 1 ? tm('living_deceased') : v === 0 ? tm('living_living') : t('merge_value_living', { value: tm('living_unknown') }));
    }
    for (const f of ['birth', 'death'] as const) {
      const v = nk[f];
      if (!v) continue;
      const rawDate = v[f === 'birth' ? 'BirthDate' : 'DeathDate'];
      const rawPlace = v[f === 'birth' ? 'BirthPlace' : 'DeathPlace'];
      const date = typeof rawDate === 'string' && rawDate ? formatDateForDisplay(rawDate, language, words) : '';
      const place = typeof rawPlace === 'string' ? rawPlace : '';
      const value = date && place ? t('merge_value_in', { date, place }) : date || place || t('merge_value_none');
      parts.push(t(f === 'birth' ? 'merge_value_birth' : 'merge_value_death', { value }));
    }
    return parts.join(', ');
  };
}

export function MergeLogDetails({ log }: { log: MergeLogView }) {
  const t = useTranslations('audit');
  const notKept = useNotKeptText()(log);
  const moved = MOVED.filter((k) => (log.moved[k] ?? 0) > 0).map((k) => t(`merge_moved_${k}`, { count: log.moved[k] }));
  const combined = COMBINED.filter((k) => (log.combined[k] ?? 0) > 0).map((k) => t(`merge_combined_${k}`, { count: log.combined[k] }));
  const rows: [string, string][] = [
    [t('merge_kept'), log.keptName],
    ...(notKept ? [[t('merge_not_kept'), `${notKept}. ${t('merge_not_kept_note')}`] as [string, string]] : []),
    ...(log.alternateName ? [[t('merge_alternate'), log.alternateName] as [string, string]] : []),
    [t('merge_moved'), moved.length ? moved.join(', ') : t('merge_nothing')],
    ...(combined.length ? [[t('merge_combined'), combined.join(', ')] as [string, string]] : []),
    [t('merge_removed'), t('merge_removed_value', { name: log.mergedName })],
  ];
  return (
    <dl className="m-0 mt-2 grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-meta">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text-muted">{label}</dt>
          <dd className="m-0 text-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The revert confirmation's body for a merge: both back as they were, later changes listed first. */
export function MergeRevertBody({ entryId, log, treeId }: { entryId: number; log: MergeLogView; treeId: number | null }) {
  const t = useTranslations('audit');
  const [later, setLater] = useState<AuditLogEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    getDataClient()
      .then((client) => client.audit.listLaterChanges(entryId, treeId))
      .then((rows) => { if (live) setLater(rows); })
      .catch(() => { if (live) setLater([]); });
    return () => { live = false; };
  }, [entryId, treeId]);
  const action = (a: string) => (a === 'create' ? t('action_created') : a === 'delete' ? t('action_deleted') : t('action_updated'));
  return (
    <div className="grid gap-2">
      <p className="m-0">{t('confirm_revert_merge_body', { kept: log.keptName, other: log.mergedName })}</p>
      {later == null && <p className="m-0 text-text-muted">{t('confirm_revert_merge_loading')}</p>}
      {later != null && later.length > 0 && (
        <>
          <p className="m-0">{t('confirm_revert_merge_later', { count: later.length, kept: log.keptName })}</p>
          <ul className="m-0 grid gap-1 pl-5">
            {later.map((e) => (
              <li key={e.Id}>{action(e.Action)} · {t('filter_' + e.EntityType)}{e.EntityLabel ? ` · ${e.EntityLabel}` : ''}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
