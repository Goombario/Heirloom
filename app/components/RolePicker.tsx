'use client';

import { useRef, useEffect, useLayoutEffect, useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, PencilLine, Shield, Check, ChevronDown, UserMinus } from '@/lib/icons';
import type { LucideIcon } from '@/lib/icons';

// ── Types ──────────────────────────────────────────────────────────────────────

export type Role = 'view' | 'contribute' | 'edit';

export interface RoleEntry {
  key: Role;
  /** Translation key inside the shareTree namespace for the short role label. */
  labelKey: string;
  /** Translation key inside the shareTree namespace for the one-line description. */
  descKey: string;
  /** Lucide icon — paired with label + description for colorblind-safe cues. */
  icon: LucideIcon;
}

/**
 * Single source of truth for role options.
 * Import this in both the invite row and each collaborator row so that
 * label strings and icon choices never drift between the two usages.
 */
export const ROLES: RoleEntry[] = [
  { key: 'view',       labelKey: 'permission_view',       descKey: 'role_view_desc',       icon: Eye       },
  { key: 'contribute', labelKey: 'permission_contribute', descKey: 'role_contribute_desc', icon: PencilLine },
  { key: 'edit',       labelKey: 'permission_edit',       descKey: 'role_edit_desc',       icon: Shield    },
];

export interface RolePickerProps {
  value: Role;
  onChange: (role: Role) => void;
  /** When set, renders a trailing danger "Remove access" item in the menu. */
  onRemove?: () => void;
  /** Forces the menu to open upward. The menu also auto-flips when there isn't
   *  room below, so this is only an explicit override. */
  dropUp?: boolean;
  disabled?: boolean;
  /** Accessible label for the trigger button (e.g. t('shareTree.role_label', { email })). */
  triggerLabel: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function RolePicker({
  value,
  onChange,
  onRemove,
  dropUp = false,
  disabled = false,
  triggerLabel,
}: RolePickerProps) {
  const t = useTranslations('shareTree');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The menu renders as a viewport-fixed popover so it escapes the surrounding
  // Modal body's `overflow-y-auto` clip (which previously cut off collaborator
  // dropdowns near the bottom of the roster).
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const close = useCallback(() => setIsOpen(false), []);

  // ── Position the fixed menu against the trigger, flipping up when needed ───
  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const tr = triggerRef.current.getBoundingClientRect();
    const OPTION_H = 72;
    const estMenuH = OPTION_H * ROLES.length + (onRemove ? OPTION_H + 12 : 0) + 8;
    const spaceBelow = window.innerHeight - tr.bottom;
    const spaceAbove = tr.top;
    const flipUp = dropUp || (spaceBelow < estMenuH + 16 && spaceAbove > spaceBelow);
    const style: React.CSSProperties = {
      position: 'fixed',
      right: Math.max(8, Math.round(window.innerWidth - tr.right)),
      minWidth: 220,
      zIndex: 60,
    };
    if (flipUp) style.bottom = Math.round(window.innerHeight - tr.top + 4);
    else style.top = Math.round(tr.bottom + 4);
    setMenuStyle(style);
  }, [isOpen, dropUp, onRemove]);

  // ── Outside pointerdown — mirror UserMenu.tsx (menu stays a DOM child of
  //    containerRef even though it is visually fixed, so this still works) ────
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        close();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [close]);

  // ── Esc — capture phase + stopPropagation so it closes only this menu, not a
  //    surrounding Modal (which also listens for Escape on document) ──────────
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, close]);

  // ── Close on scroll/resize — a fixed menu would otherwise detach from the
  //    trigger ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    function onReflow() {
      close();
    }
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [isOpen, close]);

  const activeRole = ROLES.find((r) => r.key === value);

  function handleSelect(role: Role) {
    onChange(role);
    close();
  }

  function handleRemove() {
    onRemove?.();
    close();
  }

  // ── Shared row classes ────────────────────────────────────────────────────
  const rowBase =
    'w-full flex items-start gap-3 px-4 py-3 text-left ' +
    'hover:bg-hover-surface transition-colors duration-100 ' +
    'focus:outline-none focus-visible:bg-hover-surface';

  return (
    <div className="relative" ref={containerRef}>
      {/* ── Trigger ──────────────────────────────────────────────────────── */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        className={[
          'inline-flex items-center gap-2 px-3 py-2 min-h-11',
          'border border-border rounded-btn',
          'text-sm font-medium text-text bg-card',
          'transition-colors duration-150',
          'focus-ring',
          disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:border-primary cursor-pointer',
        ].join(' ')}
      >
        {activeRole && (
          (() => {
            const Icon = activeRole.icon;
            return <Icon className="w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />;
          })()
        )}
        <span>{activeRole ? t(activeRole.labelKey as Parameters<typeof t>[0]) : ''}</span>
        <ChevronDown
          className={[
            'w-4 h-4 shrink-0 text-text-muted transition-transform duration-150',
            isOpen ? 'rotate-180' : '',
          ].join(' ')}
          aria-hidden="true"
        />
      </button>

      {/* ── Dropdown menu (fixed popover, escapes modal overflow) ─────────── */}
      {isOpen && (
        <div
          role="menu"
          style={menuStyle}
          className="bg-card border border-border rounded-panel shadow-lg py-1"
        >
          {/* Role option rows */}
          {ROLES.map((role) => {
            const Icon = role.icon;
            const isActive = role.key === value;
            return (
              <button
                key={role.key}
                type="button"
                role="menuitem"
                onClick={() => handleSelect(role.key)}
                className={rowBase}
              >
                <Icon className="w-4 h-4 shrink-0 mt-0.5 text-text-muted" aria-hidden="true" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-text">
                    {t(role.labelKey as Parameters<typeof t>[0])}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {t(role.descKey as Parameters<typeof t>[0])}
                  </span>
                </span>
                {isActive && (
                  <Check
                    className="w-4 h-4 shrink-0 mt-0.5 text-link"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}

          {/* Remove access row (collaborator rows only) */}
          {onRemove && (
            <div className="border-t border-border mt-1 pt-1">
              <button
                type="button"
                role="menuitem"
                onClick={handleRemove}
                className={[rowBase, 'text-error'].join(' ')}
              >
                <UserMinus className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold">
                    {t('remove_access')}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {t('remove_access_desc')}
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
