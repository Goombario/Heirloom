'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, showErrorToast, showSuccessToast } from '@/app/components/ui';
import { Copy } from '@/lib/icons';
import { signInLink } from './memberText';

/** Copy the sign-in link to the clipboard, saying so either way. Returns whether it worked. */
export async function copySignInLink(messages: { copied: string; failed: string }): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(signInLink());
    showSuccessToast(messages.copied);
    return true;
  } catch {
    showErrorToast(messages.failed);
    return false;
  }
}

/** The link on a line of its own with Copy beside it, so it can also be selected by hand. */
export function CopySignInLink() {
  const t = useTranslations('members');
  const [link, setLink] = useState('');
  // eslint-disable-next-line react-hooks/set-state-in-effect -- window is only known after mount
  useEffect(() => { setLink(signInLink()); }, []);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card-alt px-2.5 py-2">
      <code className="flex-1 min-w-0 truncate font-mono text-meta text-text-secondary select-all">{link}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        icon={<Copy className="w-4 h-4" aria-hidden="true" />}
        onClick={() => void copySignInLink({ copied: t('copied'), failed: t('copy_failed') })}
      >
        {t('copy')}
      </Button>
    </div>
  );
}
