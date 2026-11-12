'use client';

import GuardedLink from '@/app/components/GuardedLink';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { DESKTOP_DESTINATIONS, UTILITY_HINTS, UTILITY_ITEMS, isNavItemActive } from './navItems';
import { ChevronDown } from '@/lib/icons';
import { useMenuKeyboard } from '@/app/components/ui/useMenuKeyboard';
import { IconTile } from '@/app/components/ui';
import { useTree } from '@/app/contexts/TreeContext';
import { useCachedResource } from '@/app/components/useCachedResource';
import { getDataClient } from '@/lib/data';

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
  const items = DESKTOP_DESTINATIONS;
  // Data checks shows how many dates are left to check (#59): Home's own cached
  // summary, fetched once the menu opens.
  const { activeTreeId, currentUserId } = useTree();
  const checks = useCachedResource(
    utilOpen && currentUserId !== null ? `dataChecks:summary:tree=${activeTreeId ?? 'default'}` : null,
    async () => (await getDataClient()).dataChecks.summary(activeTreeId),
  );
  const openChecks = checks.data?.openCount ?? 0;

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
            className="absolute left-0 mt-1 w-80 z-50 bg-card rounded-lg shadow-lg border border-border overflow-hidden py-1.5 nav-anim-fade-up">
            {UTILITY_ITEMS.map((item) => {
              const { href, labelKey, icon: Icon } = item;
              return (
              <GuardedLink key={href} href={href} onNavigate={() => setUtilOpen(false)}
                role="menuitem" tabIndex={-1}
                aria-current={isNavItemActive(item, pathname) ? 'page' : undefined}
                className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors focus-ring-inset ${
                  isNavItemActive(item, pathname) ? 'bg-surface-2' : 'hover:bg-hover-surface'}`}>
                <IconTile size={36}><Icon className="w-[18px] h-[18px]" /></IconTile>
                <span className="grid min-w-0 flex-1">
                  <span className="font-medium text-text">{t(labelKey)}</span>
                  {UTILITY_HINTS[labelKey] && <span className="text-meta text-text-muted">{t(UTILITY_HINTS[labelKey])}</span>}
                </span>
                {href === '/data-checks' && openChecks > 0 && (
                  <span className="shrink-0 rounded-full bg-[color:var(--color-warning-bg)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[color:var(--color-warning-text)]">
                    <span aria-hidden="true">{openChecks}</span>
                    <span className="sr-only">{t('data_checks_count', { count: openChecks })}</span>
                  </span>
                )}
              </GuardedLink>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
