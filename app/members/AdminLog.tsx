'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, EmptyState, InlineDataError } from '@/app/components/ui';
import type { MemberLogRow } from '@/lib/db/queries/members';

/**
 * The admin log (ADR 0029): invitations, role changes, revokes and restores, newest
 * first. Read-only, with no Undo: each change is easy to reverse by hand, and the
 * tree audit log's revert must never restore someone's access.
 */
export function AdminLog({ entries, failed, onRetry }: {
  entries: MemberLogRow[] | null;
  failed: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('members');
  const tc = useTranslations('common');
  const locale = useLocale();
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  if (failed && !entries) return <InlineDataError message={t('log_failed')} retryLabel={tc('retry')} onRetry={onRetry} />;
  if (!entries) return null;
  if (entries.length === 0) return <EmptyState variant="empty" message={t('log_empty')} />;

  const b = (chunks: React.ReactNode) => <b className="font-semibold text-text">{chunks}</b>;
  const line = (e: MemberLogRow) => {
    const actor = e.ActorId === null && (e.Action === 'bootstrap' || e.Action === 'seeded')
      ? t('log_system')
      : e.ActorName || e.ActorEmail || t('log_someone');
    const email = e.Email ?? '';
    const role = e.Role ?? 'member';
    switch (e.Action) {
      case 'invited': return t.rich('log_invited', { b, actor, email, role });
      case 'accepted': return t.rich('log_accepted', { b, actor });
      case 'cancelled': return t.rich('log_cancelled', { b, actor, email });
      case 'role_changed': return t.rich('log_role_changed', { b, actor, email, role });
      case 'revoked': return t.rich('log_revoked', { b, actor, email });
      case 'restored': return t.rich('log_restored', { b, actor, email });
      case 'bootstrap': return t.rich('log_bootstrap', { b, actor, email });
      case 'seeded': return t.rich('log_seeded', { b, actor, count: e.Count ?? 0 });
    }
  };

  return (
    <Card pad={false} className="max-md:rounded-none max-md:shadow-none max-md:bg-transparent">
      <ul aria-label={t('log_label')} className="m-0 p-0 list-none">
        {entries.map((e, i) => (
          <li
            key={e.Id}
            className={`grid gap-1 md:grid-cols-[170px_1fr] md:gap-3.5 px-4 py-3 text-sm text-text-secondary ${i > 0 ? 'border-t border-border' : ''}`}
          >
            <time dateTime={e.CreatedAt} className="date-mono text-meta">{when.format(new Date(e.CreatedAt))}</time>
            <span>{line(e)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
