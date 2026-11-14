'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/app/components/ui';
import { Plus } from '@/lib/icons';
import { ExternalLink } from '@/app/components/ExternalLink';
import { contactHref } from '@/lib/utils/contact-links';

/**
 * The picked repository, named above the Sources table (#1154): no box, just its
 * name, address and source count, its website, email and phone (ADR 0049), with Edit and Add a source here. The table drops its
 * Repository column while this shows.
 */
export default function RepositoryHeader({
  name,
  address,
  contacts,
  count,
  canEdit,
  onEdit,
  onAddSource,
}: {
  name: string;
  address: string | null;
  contacts?: { Website?: string | null; Phone?: string | null; Email?: string | null };
  count: number;
  canEdit: boolean;
  onEdit: () => void;
  onAddSource: () => void;
}) {
  const t = useTranslations('library');
  const line = [address?.trim(), t('source_count', { count })].filter(Boolean).join(' · ');
  return (
    <div data-testid="library-repository-header" className="mb-1 flex flex-wrap items-start justify-between gap-4 pb-4">
      <div className="min-w-0">
        <div className="eyebrow">{t('filter_repository')}</div>
        <h2 className="title-dialog mt-0.5">{name}</h2>
        <div className="mt-0.5 text-sm text-text-muted">{line}</div>
        {(contacts?.Website || contacts?.Email || contacts?.Phone) && (
          <div data-testid="library-repository-contacts" className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
            {(['Website', 'Email', 'Phone'] as const).filter((key) => contacts[key]?.trim()).map((key) => {
              const value = contacts[key]!.trim();
              const href = contactHref(key, value);
              const label = t(`repo_field_${key.toLowerCase() as 'website' | 'email' | 'phone'}`);
              if (!href) return <span key={key} className="text-text-secondary [overflow-wrap:anywhere]" title={label}>{value}</span>;
              return key === 'Website'
                ? <ExternalLink key={key} href={href} className="text-link hover:underline [overflow-wrap:anywhere]" title={label}>{value}</ExternalLink>
                : <a key={key} href={href} className="text-link hover:underline [overflow-wrap:anywhere]" title={label}>{value}</a>;
            })}
          </div>
        )}
      </div>
      {canEdit && (
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>{t('repo_edit')}</Button>
          <Button variant="outline" size="sm" icon={<Plus size={14} aria-hidden="true" />} onClick={onAddSource}>
            {t('add_source_here')}
          </Button>
        </div>
      )}
    </div>
  );
}
