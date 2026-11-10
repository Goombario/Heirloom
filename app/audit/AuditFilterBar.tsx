'use client';

import { useTranslations } from 'next-intl';
import { DATA_MODE } from '@/lib/data';
import { FilterChip, Badge, Select } from '@/app/components/ui';
import { Search, UserRound } from '@/lib/icons';
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
  count: number;
}

/** The type chips, shared with the phone sheet. '' is "All types". */
export const ENTITY_TYPES = ['', 'person', 'family', 'familychild', 'event', 'media', 'note', 'case', 'datacheck', 'import'];
const ACTIONS = ['', 'create', 'update', 'delete'];

function actionKey(a: string): string {
  return a === 'create' ? 'action_created' : a === 'update' ? 'action_updated' : a === 'delete' ? 'action_deleted' : 'action_all';
}

export function AuditFilterBar({ filters, onPatch, editors, entryDates, count }: AuditFilterBarProps) {
  const t = useTranslations('audit');

  const actionLabel = t(actionKey(filters.action));
  const whoLabel = filters.who == null ? t('who_everyone') : (editors.find((e) => e.userId === filters.who)?.name ?? t('who_everyone'));

  const tokens: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.action) tokens.push({ key: 'action', label: t('token_action', { value: actionLabel }), onRemove: () => onPatch({ action: '' }) });
  if (filters.who != null) tokens.push({ key: 'who', label: t('token_who', { value: whoLabel }), onRemove: () => onPatch({ who: null }) });
  if (filters.dateFrom) {
    const dv = filters.dateTo && filters.dateTo !== filters.dateFrom ? `${filters.dateFrom} – ${filters.dateTo}` : filters.dateFrom;
    tokens.push({ key: 'date', label: t('token_date', { value: dv }), onRemove: () => onPatch({ dateFrom: undefined, dateTo: undefined }) });
  }
  if (filters.search) tokens.push({ key: 'search', label: t('token_record', { value: filters.search }), onRemove: () => onPatch({ search: '' }) });

  return (
    <div className="mb-3">
      {/* type chips + count */}
      <div className="flex items-center gap-2.5 flex-wrap mb-3">
        <div className="flex gap-1.5 flex-wrap">
          {ENTITY_TYPES.map((type) => (
            <FilterChip
              key={type || 'all'}
              active={filters.entityType === type}
              onClick={() => onPatch({ entityType: type })}
            >
              {type ? t('filter_' + type) : t('filter_all')}
            </FilterChip>
          ))}
        </div>
        <span className="text-meta" style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {t('entry_count', { count })}
        </span>
      </div>

      {/* filter toolbar: Action · Who · Date · Record. No visible "Filter" eyebrow, so it
          reads as one toolbar with the type chips above (CT-2); the name stays for AT. */}
      <div role="group" aria-label={t('filter_label')} className="flex items-center gap-2 flex-wrap border border-[color:var(--border)] rounded-[10px] py-2 px-2.5 relative z-[16]" style={{ background: 'var(--card-alt)' }}>
        {/* Action */}
        <Select
          label={t('col_action')}
          valueLabel={actionLabel}
          options={ACTIONS.map((a) => ({ key: a || 'all', value: a, label: t(actionKey(a)) }))}
          isSelected={(v) => filters.action === v}
          onSelect={(v) => onPatch({ action: v })}
        />

        {/* Who — omitted in the single-user static build, where every row is the
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

        {/* Date */}
        <AuditDateRange
          from={filters.dateFrom}
          to={filters.dateTo}
          entryDates={entryDates}
          onChange={(r) => onPatch({ dateFrom: r.from, dateTo: r.to })}
          labels={{ date: t('filter_date'), anyDate: t('date_any'), today: t('date_today'), hint: t('date_hint') }}
        />

        {/* Record search */}
        <div className="relative">
          <Search size={14} aria-hidden className="absolute left-2.5" style={{ color: 'var(--text-muted)', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            value={filters.search}
            onChange={(e) => onPatch({ search: e.target.value })}
            placeholder={t('filter_record_placeholder')}
            aria-label={t('filter_record_placeholder')}
            className="border border-[color:var(--border)] rounded-[8px] py-1.5 pr-2.5 pl-[30px] text-meta w-[170px] focus-ring"
            style={{ background: 'var(--card)', color: 'var(--text)' }}
          />
        </div>
      </div>

      {/* active tokens */}
      {tokens.length > 0 && (
        <div className="flex items-center gap-[7px] flex-wrap mt-3">
          {tokens.map((tk) => (
            <Badge key={tk.key} tone="neutral" shape="pill" className="text-meta gap-[5px]">
              {tk.label}
              <button type="button" onClick={tk.onRemove} aria-label={t('clear')} title={t('clear')} style={{ cursor: 'pointer', opacity: 0.7, background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit' }}>✕</button>
            </Badge>
          ))}
          <button type="button" onClick={() => onPatch({ action: '', who: null, dateFrom: undefined, dateTo: undefined, search: '' })} className="text-meta" style={{ color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline', background: 'none', border: 'none' }}>
            {t('clear_all')}
          </button>
        </div>
      )}
    </div>
  );
}
