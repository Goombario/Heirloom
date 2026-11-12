'use client';

import { useTranslations } from 'next-intl';
import { DATA_MODE } from '@/lib/data';
import { ListToolbar, Select } from '@/app/components/ui';
import { UserRound } from '@/lib/icons';
import PersonAvatar from '@/app/components/PersonAvatar';
import { AuditDateRange } from './AuditDateRange';
import type { AuditEditor } from '@/lib/data/types';

export interface AuditFilters {
  entityType: string;
  action: string;
  who: number | null;
  dateFrom?: string;
  dateTo?: string;
  search: string;
  sort: string;
  dir: 'asc' | 'desc';
}

export interface AuditFilterBarProps {
  filters: AuditFilters;
  onPatch: (patch: Partial<AuditFilters>) => void;
  editors: AuditEditor[];
  entryDates: Set<string>;
}

/** The type chips, shared with the phone sheet. '' is "All types". */
export const ENTITY_TYPES = ['', 'person', 'family', 'familychild', 'event', 'media', 'note', 'case', 'datacheck', 'import'];
const ACTIONS = ['', 'create', 'update', 'delete'];

function actionKey(a: string): string {
  return a === 'create' ? 'action_created' : a === 'update' ? 'action_updated' : a === 'delete' ? 'action_deleted' : 'action_all';
}

export function AuditFilterBar({ filters, onPatch, editors, entryDates }: AuditFilterBarProps) {
  const t = useTranslations('audit');

  const actionLabel = t(actionKey(filters.action));
  const whoLabel = filters.who == null ? t('who_everyone') : (editors.find((e) => e.userId === filters.who)?.name ?? t('who_everyone'));

  const anyFilter = filters.entityType !== '' || filters.action !== '' || filters.who != null || !!filters.dateFrom || filters.search !== '';

  return (
    <div className="mb-3">
      {/* The list toolbar (#59): the record search, then Type, Action, Who and When. */}
      <ListToolbar
        search={filters.search}
        onSearchChange={(v) => onPatch({ search: v })}
        searchLabel={t('filter_record_placeholder')}
        filters={<>
          <Select
            label={t('col_type')}
            valueLabel={filters.entityType ? t('filter_' + filters.entityType) : t('filter_all')}
            options={ENTITY_TYPES.map((type) => ({ key: type || 'all', value: type, label: type ? t('filter_' + type) : t('filter_all') }))}
            isSelected={(v) => filters.entityType === v}
            onSelect={(v) => onPatch({ entityType: v })}
          />
          <Select
            label={t('col_action')}
            valueLabel={actionLabel}
            options={ACTIONS.map((a) => ({ key: a || 'all', value: a, label: t(actionKey(a)) }))}
            isSelected={(v) => filters.action === v}
            onSelect={(v) => onPatch({ action: v })}
          />
          {/* Who: left out of the single-user static build, where every row is the
              same person and the filter can only ever narrow to everything. */}
          {DATA_MODE !== 'local' && <Select<number | null>
            label={t('col_who')}
            valueLabel={whoLabel}
            options={[
              { key: 'everyone', value: null, label: t('who_everyone') },
              ...editors.map((ed) => ({
                key: String(ed.userId),
                value: ed.userId,
                label: (
                  <>
                    <PersonAvatar as="span" icon={<UserRound size={11} aria-hidden />} size={20} />
                    {ed.name}
                  </>
                ),
              })),
            ]}
            isSelected={(v) => filters.who === v}
            onSelect={(v) => onPatch({ who: v })}
          />}
          <AuditDateRange
            from={filters.dateFrom}
            to={filters.dateTo}
            entryDates={entryDates}
            onChange={(r) => onPatch({ dateFrom: r.from, dateTo: r.to })}
            labels={{ date: t('filter_date'), anyDate: t('date_any'), today: t('date_today'), hint: t('date_hint') }}
          />
          {anyFilter && (
            <button type="button" onClick={() => onPatch({ entityType: '', action: '', who: null, dateFrom: undefined, dateTo: undefined, search: '' })}
              className="text-meta text-text-muted underline bg-transparent border-0 cursor-pointer focus-ring">
              {t('clear_all')}
            </button>
          )}
        </>}
      />

    </div>
  );
}
