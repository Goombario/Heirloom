'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Banner } from '@/app/components/ui';
import { useDebounce } from '@/app/hooks/useDebounce';
import { Info } from '@/lib/icons';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Share tree's warning (#656, ADR 0029): sharing with an address that isn't an
 * active member is allowed, but it won't work until an admin invites them. An admin
 * also gets "Invite them too", which opens Invite with the address filled in.
 * Hosted only; the caller doesn't render it in the static or desktop builds.
 */
export function NotMemberBanner({ email, onNavigate, className }: {
  email: string;
  /** Called before following "Invite them too" (close the dialog). */
  onNavigate?: () => void;
  className?: string;
}) {
  const t = useTranslations('members');
  const typed = useDebounce(email.trim().toLowerCase(), 400);
  const [result, setResult] = useState<{ email: string; member: boolean; canInvite: boolean } | null>(null);

  useEffect(() => {
    if (!EMAIL.test(typed)) return;
    let live = true;
    fetch(`/api/members/check?email=${encodeURIComponent(typed)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { member: boolean; canInvite: boolean } | null) => {
        if (live && data) setResult({ email: typed, ...data });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [typed]);

  if (!result || result.member || result.email !== email.trim().toLowerCase()) return null;
  const name = result.email.split('@')[0];
  return (
    <Banner tone="warning" role="status" icon={<Info className="w-4 h-4" />} className={className}>
      <p className="m-0">{t.rich('share_not_member', { name, b: (c) => <b>{c}</b> })}</p>
      {result.canInvite && (
        <Link
          href={`/members?invite=${encodeURIComponent(result.email)}`}
          onClick={onNavigate}
          className="inline-block mt-1 font-semibold underline focus-ring rounded-sm"
        >
          {t('share_invite_too')}
        </Link>
      )}
    </Banner>
  );
}
