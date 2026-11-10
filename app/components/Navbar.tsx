'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import TopRail from './nav/TopRail';
import MobileDrawer from './nav/MobileDrawer';
import ShareTreeButton from './ShareTreeButton';
import BackupModal from './backup/BackupModal';
import { OPEN_APP_MENU } from './nav/appEvents';

export default function Navbar() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  // A screen's own header (the mobile list kit) opens the same drawer.
  useEffect(() => {
    const open = () => setDrawerOpen(true);
    document.addEventListener(OPEN_APP_MENU, open);
    return () => document.removeEventListener(OPEN_APP_MENU, open);
  }, []);
  // Sign-in and auth-error pages stand alone: the signed-in nav (tree switcher,
  // search) there reads as "you're already signed in" (FL-3).
  const pathname = usePathname();
  if (pathname?.startsWith('/auth/')) return null;
  return (
    <>
      <TopRail onOpenDrawer={() => setDrawerOpen(true)} drawerOpen={drawerOpen} />
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onManageSharing={() => { setDrawerOpen(false); setShareOpen(true); }}
        onOpenBackup={() => { setDrawerOpen(false); setBackupOpen(true); }}
      />
      {/* Share-tree modal for the mobile drawer, mounted OUTSIDE the drawer so it
          isn't confined by Vaul's transform and survives the drawer closing.
          Elevated (z-80) so it sits above the drawer's close animation.
          Renders null in local/desktop/no-session builds. */}
      <ShareTreeButton forceOpen={shareOpen} onClose={() => setShareOpen(false)} elevated />
      {/* Backup modal lifted out of the drawer (same reason as above) — the
          drawer's Backup row only renders in local-first builds. */}
      <BackupModal open={backupOpen} onClose={() => setBackupOpen(false)} />
    </>
  );
}
