'use client';

import { useTranslations } from 'next-intl';
import { RadioRow } from '@/app/components/ui';
import type { MemberRole } from '@/lib/db/queries/members';

/** Member or Admin as radio rows (the locked mockup), each with what it allows. */
export function RolePickerRows({ value, onChange, memberDisabled = false, className }: {
  value: MemberRole;
  onChange: (role: MemberRole) => void;
  /** The last admin can't become a member: the row is dimmed and says nothing more here. */
  memberDisabled?: boolean;
  className?: string;
}) {
  const t = useTranslations('members');
  return (
    <div role="radiogroup" aria-label={t('role_label')} className={className}>
      <RadioRow
        checked={value === 'member'}
        label={t('role_member')}
        hint={t('role_member_desc')}
        divided={false}
        disabled={memberDisabled}
        onSelect={() => onChange('member')}
      />
      <RadioRow
        checked={value === 'admin'}
        label={t('role_admin')}
        hint={t('role_admin_desc')}
        divided
        onSelect={() => onChange('admin')}
      />
    </div>
  );
}
