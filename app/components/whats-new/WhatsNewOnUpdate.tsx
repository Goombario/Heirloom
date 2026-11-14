'use client';

import { useEffect, useRef, useState } from 'react';
import { getDataClient } from '@/lib/data';
import { useTree } from '@/app/contexts/TreeContext';
import { aboutInfo } from '@/lib/about';
import { whatsNewStep, type ChangelogEntry } from '@/lib/whats-new';
import WhatsNewDialog from './WhatsNewDialog';

/**
 * Shows What's new once, on the first load after an update (#35, ADR 0051).
 * The last version seen is kept per user (the hosted account, or the one local
 * user of a browser or desktop install). A first run records the version and
 * shows nothing. The version is recorded as the list opens, so a reload or a
 * second tab doesn't show it again.
 *
 * It lives in the root layout and never unmounts, so the check runs once per
 * page load (a ref, not a cancel flag, so Strict Mode's re-run can't drop it).
 */
export default function WhatsNewOnUpdate() {
  const { currentUserId } = useTree();
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    if (currentUserId === null || checked.current) return;
    checked.current = true;
    const current = aboutInfo().version;
    (async () => {
      const client = await getDataClient();
      const step = whatsNewStep(await client.account.getLastSeenVersion(), current);
      if (step.kind === 'none') return;
      await client.account.setLastSeenVersion(current);
      if (step.kind === 'show' && step.entries.length > 0) setEntries(step.entries);
    })().catch((err) => console.warn("What's new check failed:", err));
  }, [currentUserId]);

  return <WhatsNewDialog open={entries !== null} onClose={() => setEntries(null)} entries={entries ?? []} />;
}
