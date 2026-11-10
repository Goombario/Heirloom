'use client';

import GuardedLink from '@/app/components/GuardedLink';
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Search, Menu } from '@/lib/icons';
import { isMac } from '@/lib/platform';
import DesktopNav from './DesktopNav';
import TreeSwitcher from './TreeSwitcher';
import UserMenu from '../UserMenu';
import BackupStatusChip from '../backup/BackupStatusChip';

export default function TopRail({ onOpenDrawer, drawerOpen }: { onOpenDrawer: () => void; drawerOpen: boolean }) {
  const t = useTranslations('nav');
  // OS-specific shortcut hint. Resolved after mount to avoid SSR/hydration drift.
  const [mac, setMac] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMac(isMac()); }, []);
  // Hairline at rest; a soft shadow once the document has scrolled (#753). The
  // document scrolls at every width, so window is the only scroller to watch.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  const searchHint = mac ? '⌘K' : 'Ctrl+K';
  const openSearch = () => document.dispatchEvent(new CustomEvent('open-global-search'));

  return (
    <nav aria-label={t('main_navigation')} className={`app-nav text-white sticky top-0 z-40 transition-shadow ${scrolled ? 'shadow-[var(--shadow-nav-scrolled)]' : 'shadow-[var(--shadow-nav)]'}`} style={{ background: 'var(--color-nav-bg)' }}>
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between gap-4 h-14">
          <div className="flex items-center min-w-0">
            {/* Mobile menu: opens the left slide-over drawer (desktop uses DesktopNav) */}
            <button onClick={onOpenDrawer} aria-label={t('toggle_menu')} title={t('toggle_menu')}
              aria-expanded={drawerOpen} aria-controls="mobile-nav-drawer"
              className="md:hidden h-11 w-11 -ml-1.5 mr-0.5 flex items-center justify-center rounded-lg text-white/90 hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
              <Menu className="w-[22px] h-[22px]" aria-hidden="true" />
            </button>
            <GuardedLink href="/" className="font-bold text-xl mr-4 lg:mr-8 hover:opacity-80 transition-opacity serif shrink-0">
              {t('title')}
            </GuardedLink>
            <DesktopNav className="hidden lg:flex" />
          </div>

          <div className="flex items-center gap-1 lg:gap-2 shrink-0">
            {/* Tree switcher: dropdown on desktop; mobile switcher lives in the drawer */}
            <span className="hidden md:block"><TreeSwitcher variant="dropdown" /></span>

            <button onClick={openSearch} aria-label={`${t('search')} (${searchHint})`} title={`${t('search')} (${searchHint})`}
              // Width tracks --control-h so the icon-only button stays square: on a
              // coarse pointer the token is 50px, and a fixed w-9 would have made it
              // a 36×50 sliver next to the 44×44 hamburger.
              className="control-h w-[var(--control-h)] xl:w-auto xl:px-3 flex items-center justify-center gap-2 rounded-lg text-white/90 bg-white/10 hover:bg-white/20 transition-colors">
              <Search className="w-[18px] h-[18px]" aria-hidden="true" />
              <kbd className="hidden xl:inline px-1.5 py-0.5 text-xs bg-black/20 text-white rounded font-mono">{searchHint}</kbd>
            </button>

            {/* Backup status: desktop only (mobile backup lives in the nav rebuild) */}
            <span className="hidden md:block"><BackupStatusChip /></span>

            {/* Account menu: desktop only (mobile account lives in the More sheet) */}
            <div className="hidden md:block"><UserMenu /></div>
          </div>
        </div>
        {/* md–lg: the labelled destinations don't fit beside the controls in any
            locale, so they take a row of their own rather than shrinking to icons
            (#806). --nav-h accounts for the extra row at these widths. */}
        <DesktopNav className="hidden md:flex lg:hidden h-10 -mt-1 pb-1 -mx-2" />
      </div>
    </nav>
  );
}
