'use client';

import { signOut, useSession } from 'next-auth/react';
import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useDesktopMode, useDesktopModeResolved } from '@/app/hooks/useDesktopMode';
import { DATA_MODE } from '@/lib/data';
import ShareTreeButton from './ShareTreeButton';
import { useMenuKeyboard } from './ui/useMenuKeyboard';
import { Settings, Share2, Users } from '@/lib/icons';
import { useMembersAdmin } from '@/app/hooks/useMembersAdmin';
import { aboutInfo } from '@/lib/about';

export default function UserMenu() {
  const { data: session, status } = useSession();
  const isDesktop = useDesktopMode();
  const desktopResolved = useDesktopModeResolved();
  const [isOpen, setIsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const t = useTranslations('userMenu');
  const tm = useTranslations('members');
  const ta = useTranslations('about');
  const { version } = aboutInfo();
  const isMembersAdmin = useMembersAdmin();

  const closeMenu = useCallback((returnFocus: boolean) => {
    setIsOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);
  const onMenuKeyDown = useMenuKeyboard({ open: isOpen, menuRef: itemsRef, onClose: closeMenu });

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  // Local-first static build: no auth server, so no account/sign-in UI — but
  // Settings (theme, language, backup/restore, reset) lives on /options, so keep
  // a link to it. Without this the static app has no way to reach /options.
  if (DATA_MODE === 'local') {
    return (
      <Link
        href="/options"
        className="w-9 h-9 flex items-center justify-center rounded-full text-white/80 bg-white/10 hover:bg-white/20 transition-colors"
        title={t('options')}
        aria-label={t('options')}
      >
        <Settings className="w-[18px] h-[18px]" aria-hidden="true" />
      </Link>
    );
  }

  // Desktop mode: no user menu, just an options link
  if (isDesktop) {
    return (
      <Link
        href="/options"
        className="w-9 h-9 flex items-center justify-center rounded-full text-white/80 bg-white/10 hover:bg-white/20 transition-colors"
        title={t('options')}
        aria-label={t('options')}
      >
        <Settings className="w-[18px] h-[18px]" aria-hidden="true" />
      </Link>
    );
  }

  if (!desktopResolved || status === 'loading') {
    return null;
  }

  if (status === 'unauthenticated') {
    return (
      <Link
        href="/auth/signin"
        className="px-4 py-2 text-sm font-medium hover:text-primary-dark"
      >
        {t('sign_in')}
      </Link>
    );
  }

  const user = session?.user;
  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.[0]?.toUpperCase() || '?';

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="flex items-center gap-2 rounded-full focus-ring"
        aria-label={t('menu_label')}
        title={t('menu_label')}
      >
        <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-white text-sm font-medium">
          {initials}
        </div>
      </button>

      {/* Always mounted so the modal survives the dropdown closing */}
      <ShareTreeButton forceOpen={shareOpen} onClose={() => setShareOpen(false)} />

      {isOpen && (
        // overflow-hidden: the menu items' hover background paints to the square
        // bounds, so the last item bled past the bottom corners on hover. The items
        // are full-bleed, so their focus ring has to be inset or the clip eats it.
        // eslint-disable-next-line no-restricted-syntax -- intentional dropdown-menu surface (positioned, ring/shadow), not a content Card
        <div className="absolute right-0 mt-2 w-64 bg-card rounded-xl overflow-hidden shadow-lg ring-1 ring-black ring-opacity-5 z-50">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-medium text-text truncate">
              {user?.name || user?.email || '?'}
            </p>
            <p className="text-xs text-text-muted truncate">
              {user?.email}{isMembersAdmin && ` · ${tm('role_admin')}`}
            </p>
          </div>

          <div className="py-1" ref={itemsRef} role="menu" aria-label={t('menu_label')} onKeyDown={onMenuKeyDown}>
            <Link
              href="/options"
              onClick={() => setIsOpen(false)}
              className="block w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-hover-surface focus-ring-inset" role="menuitem" tabIndex={-1}
            >
              {t('options')}
            </Link>
            <button
              onClick={() => { setIsOpen(false); setShareOpen(true); }}
              className="flex items-center gap-2 w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-hover-surface focus-ring-inset" role="menuitem" tabIndex={-1}
            >
              <Share2 className="w-4 h-4" aria-hidden="true" /> {t('share_tree')}
            </button>
            {/* Admins only (ADR 0029). Apart from Share tree on purpose: Share tree
                decides who sees one tree, Members who can sign in at all. */}
            {isMembersAdmin && (
              <Link
                href="/members"
                onClick={() => setIsOpen(false)}
                className="flex items-start gap-2 w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-hover-surface focus-ring-inset" role="menuitem" tabIndex={-1}
              >
                <Users className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span className="grid">
                  <span>{tm('menu_item')}</span>
                  <span className="text-xs text-text-muted">{tm('menu_hint')}</span>
                </span>
              </Link>
            )}
            <button
              onClick={() => {
                setIsOpen(false);
                signOut({ callbackUrl: '/auth/signin' });
              }}
              className="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-hover-surface focus-ring-inset" role="menuitem" tabIndex={-1}
            >
              {t('sign_out')}
            </button>
            {/* The menu's last row, under a divider (#1256): the way to the version,
                licence and source link from every screen, the tree included. */}
            <Link
              href="/about"
              onClick={() => setIsOpen(false)}
              className="flex items-baseline justify-between gap-3 w-full mt-1 px-4 pt-2.5 pb-2 border-t border-border text-xs text-text-muted hover:bg-hover-surface focus-ring-inset" role="menuitem" tabIndex={-1}
            >
              <span className="text-link">{ta('menu_row')}</span>
              {version && <span>{ta('menu_version', { version })}</span>}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
