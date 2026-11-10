'use client';

import GuardedLink from '@/app/components/GuardedLink';
import { useLayoutEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Drawer } from 'vaul';
import { signOut, useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { DATA_MODE } from '@/lib/data';
import { useDesktopMode } from '@/app/hooks/useDesktopMode';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import {
  HOME_ITEM, PRIMARY_DESTINATIONS, SECONDARY_DESTINATIONS, UTILITY_ITEMS, OPTIONS_ITEM, isNavItemActive,
} from './navItems';
import { Settings, LogOut, X, Cloud, Users } from '@/lib/icons';
import { useMembersAdmin } from '@/app/hooks/useMembersAdmin';
import TreeSwitcher from './TreeSwitcher';
import { useBackupOverdue } from '@/app/components/backup/useBackupStatus';
import { GlassButton } from '@/app/components/ui/MobileControls';
import { aboutInfo } from '@/lib/about';

/**
 * Mobile navigation — a full-height left slide-over drawer (Vaul `direction="left"`),
 * replacing the bottom tab bar. Consolidates the tree switcher, all destinations,
 * utilities, Options and the account row into one sheet. Renders nothing on desktop
 * (Vaul portals escape `md:hidden`, so we gate on `useIsMobile()` like `ui/Sheet`).
 */
export default function MobileDrawer({ open, onClose, onManageSharing, onOpenBackup }: {
  open: boolean;
  onClose: () => void;
  /** Close the drawer and open the lifted (full-size) Share-tree modal. */
  onManageSharing: () => void;
  /** Close the drawer and open the lifted backup modal (local-first builds). */
  onOpenBackup: () => void;
}) {
  const t = useTranslations('nav');
  const tu = useTranslations('userMenu');
  const tc = useTranslations('common');
  const to = useTranslations('options');
  const tm = useTranslations('members');
  const ta = useTranslations('about');
  const { version } = aboutInfo();
  const isMembersAdmin = useMembersAdmin();
  const pathname = usePathname();
  const { data: session } = useSession();
  const isDesktop = useDesktopMode();
  const isMobile = useIsMobile();
  const { overdue, lastBackup } = useBackupOverdue();
  const backupOverdue = overdue === true;
  const lastBackupLabel = lastBackup
    ? to('backup_last', { date: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(lastBackup) })
    : to('backup_never');
  const showAccount = DATA_MODE !== 'local' && !isDesktop && !!session?.user;

  // Focus moves into the drawer on open (its close button) and returns to the
  // control that opened it on close, so Tab never walks the page behind (#854).
  const openerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);

  // Early return AFTER hooks — safe per rules-of-hooks.
  if (!isMobile) return null;

  const user = session?.user;
  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.[0]?.toUpperCase() || '?';

  const destinations = [HOME_ITEM, ...PRIMARY_DESTINATIONS, ...SECONDARY_DESTINATIONS];

  return (
    <Drawer.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }} direction="left" autoFocus>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-70 bg-black/45" />
        <Drawer.Content
          id="mobile-nav-drawer"
          className="fixed left-0 top-0 h-dvh z-70 w-[308px] max-w-[85%] bg-surface outline-none flex flex-col"
          aria-label={t('main_navigation')}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (openerRef.current?.isConnected) openerRef.current.focus();
          }}
        >
          <Drawer.Title className="sr-only">{t('main_navigation')}</Drawer.Title>

          {/* The dark band (#1122): slate in light mode, the hero gradient in dark, running up
              under the status bar. Heirloom and a glass ✕, then the tree switcher panel. */}
          <div className="hero-dark mp-slim-bar rounded-none shadow-none shrink-0 grid gap-1.5 pl-4 pr-3 pb-3.5 pt-[var(--sat)] text-white">
            <div className="flex items-center justify-between h-[46px]">
              <span className="serif text-xl font-semibold">{t('title')}</span>
              <GlassButton label={tc('close')} icon={<X />} onClick={onClose} />
            </div>
            {/* Hosted builds hide it until a session exists; single-user builds always show it. */}
            <TreeSwitcher variant="drawer" onManageSharing={onManageSharing} />
          </div>

          {/* Scrolling content. The drawer is the dynamic viewport's height, so it ends
              above Safari's toolbar, and the bottom padding clears the home indicator:
              the last row (Options) was hidden behind them (#1106). */}
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
            <span className="eyebrow block px-2.5 pt-3.5 pb-1">{t('go_to')}</span>
            <div className="flex flex-col gap-0.5">
              {destinations.map((item) => {
                const { href, labelKey, icon: Icon } = item;
                const active = isNavItemActive(item, pathname);
                return (
                  <GuardedLink key={href} href={href} onNavigate={() => onClose()} aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 px-3 min-h-[44px] rounded-lg text-md transition-colors focus-ring ${
                      active
                        ? 'bg-surface-2 text-text font-semibold'
                        : 'text-text-secondary font-medium hover:bg-[color:var(--color-hover-surface)]'}`}>
                    <Icon className={`w-[20px] h-[20px] shrink-0 ${active ? 'text-text' : 'text-text-muted'}`} aria-hidden="true" />
                    <span className="flex-1">{t(labelKey)}</span>
                  </GuardedLink>
                );
              })}
            </div>

            {/* Utilities: the same compact rows under a Tools eyebrow */}
            <span className="eyebrow block px-2.5 pt-3.5 pb-1 mt-2.5 border-t border-border">{t('tools')}</span>
            <div className="flex flex-col gap-0.5">
              {UTILITY_ITEMS.map((item) => {
                const { href, labelKey, icon: Icon } = item;
                const active = isNavItemActive(item, pathname);
                return (
                  <GuardedLink key={href} href={href} onNavigate={() => onClose()} aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 px-3 min-h-[44px] rounded-lg text-md transition-colors focus-ring ${
                      active
                        ? 'bg-surface-2 text-text font-semibold'
                        : 'text-text-secondary font-medium hover:bg-[color:var(--color-hover-surface)]'}`}>
                    <Icon className={`w-[20px] h-[20px] shrink-0 ${active ? 'text-text' : 'text-text-muted'}`} aria-hidden="true" />
                    <span className="flex-1">{t(labelKey)}</span>
                  </GuardedLink>
                );
              })}
            </div>

            {/* Options + account — anchored to the bottom */}
            <div className="mt-auto pt-2 border-t border-[color:var(--border-light)]">
              {DATA_MODE === 'local' && (
                <button type="button" onClick={() => { onClose(); onOpenBackup(); }}
                  className="flex items-center gap-3 px-3 min-h-[44px] py-1.5 w-full rounded-lg text-md font-medium text-text hover:bg-[color:var(--color-hover-surface)] transition-colors focus-ring">
                  <Cloud className={`w-[20px] h-[20px] shrink-0 ${backupOverdue ? 'text-warning-text' : 'text-text-muted'}`} aria-hidden="true" />
                  <span className="flex-1 text-left min-w-0">
                    <span className="block">{to('backup_modal_title')}</span>
                    <span className="block text-xs font-normal text-text-muted truncate">{lastBackupLabel}</span>
                  </span>
                  {backupOverdue && (
                    <span className="text-xs font-semibold text-warning-text px-2 py-0.5 rounded-full bg-warning-bg shrink-0">{to('backup_overdue')}</span>
                  )}
                </button>
              )}
              <GuardedLink href={OPTIONS_ITEM.href} onNavigate={() => onClose()} aria-current={pathname === OPTIONS_ITEM.href ? 'page' : undefined}
                className={`flex items-center gap-3 px-3 min-h-[44px] rounded-lg text-md transition-colors focus-ring ${
                  pathname === OPTIONS_ITEM.href ? 'bg-surface-2 text-text font-semibold' : 'font-medium text-text-secondary hover:bg-[color:var(--color-hover-surface)]'}`}>
                <Settings className={`w-[20px] h-[20px] shrink-0 ${pathname === OPTIONS_ITEM.href ? 'text-text' : 'text-text-muted'}`} aria-hidden="true" />
                <span className="flex-1">{t(OPTIONS_ITEM.labelKey)}</span>
              </GuardedLink>

              {/* Admins only, between Options and Sign out (ADR 0029). */}
              {isMembersAdmin && (
                <GuardedLink href="/members" onNavigate={() => onClose()} aria-current={pathname === '/members' ? 'page' : undefined}
                  className={`flex items-center gap-3 px-3 min-h-[44px] rounded-lg text-md transition-colors focus-ring ${
                    pathname === '/members' ? 'bg-surface-2 text-text font-semibold' : 'font-medium text-text-secondary hover:bg-[color:var(--color-hover-surface)]'}`}>
                  <Users className={`w-[20px] h-[20px] shrink-0 ${pathname === '/members' ? 'text-text' : 'text-text-muted'}`} aria-hidden="true" />
                  <span className="flex-1">{tm('menu_item')}</span>
                </GuardedLink>
              )}

              {showAccount && (
                <div className="flex items-center gap-3 px-1.5 pt-2">
                  <span className="avatar-neutral w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">{initials}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-text truncate">{user?.name || user?.email}</span>
                    <span className="block text-xs text-text-muted truncate">{user?.email}</span>
                  </span>
                  {/* A text link, not a boxed button (#1122). */}
                  <button onClick={() => { onClose(); signOut({ callbackUrl: '/auth/signin' }); }}
                    className="inline-flex items-center gap-1.5 min-h-11 px-1 text-sm font-medium text-text shrink-0 cursor-pointer rounded-lg focus-ring">
                    <LogOut className="w-[15px] h-[15px]" aria-hidden="true" /> {tu('sign_out')}
                  </button>
                </div>
              )}

              {/* Last in the drawer (#1256): under the account row, or under Options
                  without accounts. On a short phone it ends the scroll. */}
              <GuardedLink href="/about" onNavigate={() => onClose()} aria-current={pathname === '/about' ? 'page' : undefined}
                className="flex items-center justify-between gap-3 mx-1 mt-2 px-2 min-h-11 border-t border-[color:var(--border-light)] text-sm text-text-muted rounded-sm focus-ring">
                <span className="text-link font-medium">{ta('menu_row')}</span>
                {version && <span>{ta('menu_version', { version })}</span>}
              </GuardedLink>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
