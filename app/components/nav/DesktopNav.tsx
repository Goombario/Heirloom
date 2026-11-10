'use client';

import GuardedLink from '@/app/components/GuardedLink';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { PRIMARY_DESTINATIONS, SECONDARY_DESTINATIONS, UTILITY_ITEMS, isNavItemActive } from './navItems';
import { ChevronDown } from '@/lib/icons';
import { useMenuKeyboard } from '@/app/components/ui/useMenuKeyboard';

/** `className` places the bar: TopRail renders it inline from `lg` and on its own
 *  row between `md` and `lg`, where the labels don't fit beside the controls (#806). */
export default function DesktopNav({ className }: { className: string }) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const [utilOpen, setUtilOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closeUtil = useCallback((returnFocus: boolean) => {
    setUtilOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);
  const onMenuKeyDown = useMenuKeyboard({ open: utilOpen, menuRef, onClose: closeUtil });

  useEffect(() => {
    // A pointer dismissal leaves focus where the pointer went; Escape inside the
    // menu is handled by useMenuKeyboard, and this covers Escape from the trigger.
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setUtilOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setUtilOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const utilActive = UTILITY_ITEMS.some(u => isNavItemActive(u, pathname));
  const items = [...PRIMARY_DESTINATIONS, ...SECONDARY_DESTINATIONS];

  return (
    <div className={`items-center gap-1 ${className}`}>
      {items.map((item) => {
        const { href, labelKey } = item;
        return (
        <GuardedLink key={href} href={href}
          aria-current={isNavItemActive(item, pathname) ? 'page' : undefined}
          className={`inline-flex items-center px-2 xl:px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            isNavItemActive(item, pathname) ? 'bg-black/25 text-white' : 'text-white/90 hover:bg-white/10 hover:text-white'}`}>
          {/* Always the name: an icon alone (a heart for Families, a book for
              Library) can't be guessed (#806, T-1). */}
          {t(labelKey)}
        </GuardedLink>
        );
      })}

      <div className="relative" ref={ref}>
        <button ref={triggerRef} onClick={() => setUtilOpen(o => !o)}
          aria-expanded={utilOpen} aria-haspopup="menu"
          className={`flex items-center gap-1 px-2 xl:px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            utilActive ? 'bg-black/25 text-white' : 'text-white/90 hover:bg-white/10 hover:text-white'}`}>
          {t('tools')}
          <ChevronDown className={`w-3 h-3 transition-transform ${utilOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {utilOpen && (
          <div ref={menuRef} role="menu" aria-label={t('tools')} onKeyDown={onMenuKeyDown}
            className="absolute left-0 mt-1 w-56 z-50 bg-card rounded-lg shadow-lg border border-border overflow-hidden py-1 nav-anim-fade-up">
            {UTILITY_ITEMS.map((item) => {
              const { href, labelKey, icon: Icon } = item;
              return (
              <GuardedLink key={href} href={href} onNavigate={() => setUtilOpen(false)}
                role="menuitem" tabIndex={-1}
                aria-current={isNavItemActive(item, pathname) ? 'page' : undefined}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm transition-colors focus-ring-inset ${
                  isNavItemActive(item, pathname) ? 'text-text bg-surface-2' : 'text-text-secondary hover:bg-hover-surface'}`}>
                <Icon className="w-4 h-4" aria-hidden="true" /> {t(labelKey)}
              </GuardedLink>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
