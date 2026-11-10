'use client';

import { useState, useEffect, useId, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useTreeDisplayName } from '@/app/hooks/useTreeDisplayName';
import { useSwitchTree } from '@/app/hooks/useSwitchTree';
import { useTree } from '@/app/contexts/TreeContext';
import { useMyTrees } from '@/app/hooks/useMyTrees';
import { useActiveTreeName } from '@/app/hooks/useActiveTreeName';
import { useSharedTrees } from '@/app/hooks/useSharedTrees';
import { useDesktopMode } from '@/app/hooks/useDesktopMode';
import { DATA_MODE, getDataClient } from '@/lib/data';
import { permissionPillVariant, type Permission } from './navItems';
import { Network, ChevronDown, Check, Share2, Plus, Loader2 } from '@/lib/icons';
import { Sheet } from '@/app/components/ui/Sheet';
import Modal from '@/app/components/Modal';
import { Button } from '@/app/components/ui/Button';
import { Input } from '@/app/components/ui/Input';
import ShareTreeButton from '../ShareTreeButton';
import { useMenuKeyboard } from '@/app/components/ui/useMenuKeyboard';
import { useCachedResource } from '@/app/components/useCachedResource';

interface Row {
  key: string;
  name: string;
  meta: string;
  perm: Permission;
  active: boolean;
  onSelect: () => void;
}

export default function TreeSwitcher({ variant, onManageSharing }: {
  variant: 'dropdown' | 'sheet' | 'drawer';
  /** Drawer variant only: called instead of opening an in-drawer share modal,
   *  so the parent can close the drawer and open a lifted (full-size) modal. */
  onManageSharing?: () => void;
}) {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const treeName = useTreeDisplayName();
  const { data: session } = useSession();
  const { activeTreeId } = useTree();
  // Asks about unsaved edits and leaves a record page for its list (#916).
  const switchTree = useSwitchTree();
  const activeName = useActiveTreeName();
  const shared = useSharedTrees(session?.user?.email);
  const isDesktop = useDesktopMode();
  // The static (local) and desktop builds are single-user: no auth, no sharing —
  // but they still have multiple own trees, so the switcher renders own-trees only.
  const isSingleUser = DATA_MODE === 'local' || isDesktop;
  const { trees: myTrees, refresh } = useMyTrees();
  const [open, setOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // "New Tree" modal state
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const newTitleId = useId();

  // Desktop dropdown is a `role="menu"` (#690, INT-3): trees are radio items, the
  // actions plain items. The sheet variant opens a real dialog instead.
  const asMenu = variant === 'dropdown';
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);
  const onMenuKeyDown = useMenuKeyboard({ open: asMenu && open, menuRef, onClose: closeMenu });

  // Desktop dropdown: Escape pressed outside the menu (the mobile sheet handles
  // its own Esc). Inside the menu useMenuKeyboard closes and refocuses the trigger.
  useEffect(() => {
    if (!asMenu || !open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(true); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [asMenu, open, closeMenu]);
  const itemProps = (role: 'menuitem') => (asMenu ? { role, tabIndex: -1 } : {});

  // Hosted mode is multi-user: only render for a signed-in session.
  if (!isSingleUser && !session) return null;

  const closeNewTreeModal = () => {
    if (creating) return;
    setNewOpen(false);
    setNewName('');
    setCreateError(null);
  };

  async function handleCreateTree() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const client = await getDataClient();
      const tree = await client.trees.create(name);
      await refresh();
      switchTree({ treeId: tree.Id, permission: 'owner', treeName: tree.Name });
      setNewOpen(false);
      setNewName('');
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : tc('error'));
    } finally {
      setCreating(false);
    }
  }

  const rows: Row[] = [
    ...myTrees.map<Row>((tree, i) => ({
      key: `own-${tree.Id}`,
      name: treeName(tree.Name),
      // Same rule as shared rows and SharedTreeBanner: owner's name, else email (#893).
      meta: session?.user?.name || session?.user?.email || '',
      perm: 'owner',
      active: activeTreeId === tree.Id || (activeTreeId === null && i === 0),
      onSelect: () => {
        if (i === 0) switchTree(null);
        else switchTree({ treeId: tree.Id, permission: 'owner', treeName: tree.Name });
        setOpen(false);
      },
    })),
    // Per-tree sharing: one row per shared TREE. Legacy rows without a TreeId
    // can't be switched to (nothing to scope by) and are filtered out.
    ...(isSingleUser ? [] : shared.filter(s => s.TreeId != null).map<Row>(s => {
      const treeId = s.TreeId as number;
      const ownerLabel = s.owner?.Name || s.owner?.Email || t('shared_with_me');
      return {
        key: `shared-${treeId}`,
        name: treeName(s.TreeName) || ownerLabel,
        meta: ownerLabel,
        perm: s.Permission,
        active: activeTreeId === treeId,
        onSelect: () => {
          switchTree({
            treeId,
            permission: s.Permission,
            treeName: s.TreeName ?? undefined,
            ownerEmail: s.owner?.Email,
            ownerName: s.owner?.Name ?? undefined,
          });
          setOpen(false);
        },
      };
    })),
  ];

  const permLabel: Record<Permission, string> = {
    owner: t('perm_owner'), edit: t('perm_edit'), contribute: t('perm_contribute'), view: t('perm_view'),
  };

  const RowList = (
    <div className="flex flex-col gap-0.5">
      <span className="eyebrow block px-3 pt-1 pb-0.5" role={asMenu ? 'presentation' : undefined}>
        {t('myTrees')}
      </span>
      {rows.map((r) => (
        <button key={r.key} onClick={() => { r.onSelect(); if (asMenu) triggerRef.current?.focus(); }}
          role={asMenu ? 'menuitemradio' : undefined}
          tabIndex={asMenu ? -1 : undefined}
          aria-checked={asMenu ? r.active : undefined}
          aria-current={!asMenu && r.active ? 'true' : undefined}
          className={`flex items-center gap-3 p-3 min-h-11 rounded-xl text-left transition-colors focus-ring ${
            r.active ? 'bg-surface-2'
              : 'cursor-pointer hover:bg-[color:var(--color-hover-surface)]'}`}>
          <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-surface-2 text-text-secondary">
            <Network className="w-[19px] h-[19px]" aria-hidden="true" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-text truncate">{r.name}</span>
              {r.active && <Check className="w-4 h-4 text-text shrink-0" aria-hidden="true" />}
            </span>
            <span className="block text-xs text-text-muted truncate">{r.meta}</span>
          </span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${
            permissionPillVariant(r.perm) === 'owner'
              ? 'bg-[color:var(--surface-2)] text-text-secondary'
              : 'bg-[color:var(--surface-2)] text-text-secondary'}`}>
            {permLabel[r.perm]}
          </span>
        </button>
      ))}
      <button onClick={() => { setOpen(false); setNewOpen(true); }}
        {...itemProps('menuitem')}
        title={t('newTree')}
        className="flex items-center gap-3 p-3 min-h-11 rounded-xl text-left text-link text-sm font-medium cursor-pointer transition-colors hover:bg-[color:var(--color-hover-surface)] focus-ring">
        <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border border-dashed border-[color:var(--border)] text-link">
          <Plus className="w-[17px] h-[17px]" aria-hidden="true" />
        </span>
        {t('newTree')}
      </button>
      {!isSingleUser && (
        <button {...itemProps('menuitem')} onClick={() => {
            setOpen(false);
            // Drawer: hand off so the parent can close the drawer and open a
            // lifted full-size modal (an in-drawer modal is trapped by Vaul's
            // transform). Dropdown: open the co-located modal directly.
            if (onManageSharing) onManageSharing(); else setShareOpen(true);
          }}
          className="flex items-center gap-2 min-h-11 text-link text-sm font-medium mt-2.5 pt-3 px-1 border-t border-[color:var(--border-light)] cursor-pointer rounded-lg focus-ring">
          <Share2 className="w-[17px] h-[17px]" aria-hidden="true" /> {t('manage_sharing')}
        </button>
      )}
    </div>
  );

  // "New Tree" modal — always elevated so it escapes the mobile drawer's Vaul
  // transform (a non-portaled fixed overlay would be trapped inside the panel).
  const NewTreeModal = (
    <Modal open={newOpen} onClose={closeNewTreeModal} size="sm" disableClose={creating} labelledBy={newTitleId} elevated>
      <form
        className="bg-card rounded-2xl shadow-xl p-6"
        onSubmit={(e) => { e.preventDefault(); handleCreateTree(); }}
      >
        <h3 id={newTitleId} className="serif text-lg font-semibold text-text mb-4">{t('newTreeTitle')}</h3>
        {/* The field label is the only line under the title; the placeholder repeated
            it verbatim, which read as a subtitle in a modal this small. */}
        <Input
          size="sm"
          label={t('treeNamePlaceholder')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={creating}
          maxLength={120}
          autoFocus
        />
        {createError && (
          <p role="alert" className="mt-3 text-sm text-error">{createError}</p>
        )}
        <div className="flex justify-end gap-3 mt-5">
          <Button variant="outline" onClick={closeNewTreeModal} disabled={creating}>
            {tc('cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={creating || newName.trim().length === 0}
            className="disabled:opacity-50 disabled:cursor-not-allowed"
            icon={creating ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : undefined}>
            {tc('create')}
          </Button>
        </div>
      </form>
    </Modal>
  );

  // Drawer variant: a panel in the drawer's dark band (#1122), like the home page's:
  // "Your tree", the name in serif, your access and the counts. It opens the same sheet
  // picker; reuses RowList + the ShareTree modal.
  if (variant === 'drawer') {
    const active = rows.find((r) => r.active);
    return (
      <>
        <button onClick={() => setOpen(true)}
          className="w-full grid gap-[3px] px-3 py-2.5 rounded-[14px] border border-white/14 bg-black/20 text-left text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          aria-label={t('switch_tree_named', { name: activeName })} aria-expanded={open} aria-haspopup="dialog">
          <span className="eyebrow !text-white/70">{t('your_tree')}</span>
          <span className="flex items-center justify-between gap-2 serif text-lg font-semibold">
            <span className="truncate">{activeName}</span>
            <ChevronDown className="w-[18px] h-[18px] shrink-0 opacity-80" aria-hidden="true" />
          </span>
          <TreeCounts access={active ? permLabel[active.perm] : null} />
        </button>
        {/* Share modal is lifted to Navbar (via onManageSharing) so it isn't
            trapped by the drawer's transform and survives the drawer closing. */}
        <Sheet open={open} onClose={() => setOpen(false)} title={t('switch_tree')}>
          {RowList}
        </Sheet>
        {NewTreeModal}
      </>
    );
  }

  const Trigger = (
    <button ref={triggerRef} onClick={() => setOpen(o => !o)}
      // control-h (not py-*): the trigger sits beside the search button, and both
      // now derive their height from --control-h instead of coincidentally agreeing.
      className="flex items-center gap-1.5 max-w-[150px] md:max-w-[220px] control-h px-2.5 rounded-lg text-white text-meta bg-white/10 border border-white/20 hover:bg-white/20 transition-colors cursor-pointer focus-ring"
      aria-label={t('switch_tree_named', { name: activeName })} aria-expanded={open} aria-haspopup={variant === 'sheet' ? 'dialog' : 'menu'}>
      <Network className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span className="font-semibold truncate">{activeName}</span>
      <ChevronDown className="w-3 h-3 text-white/70 shrink-0" aria-hidden="true" />
    </button>
  );

  return (
    <div className="relative">
      {Trigger}
      {/* Always mounted so the modal survives the menu closing */}
      {!isSingleUser && <ShareTreeButton forceOpen={shareOpen} onClose={() => setShareOpen(false)} />}
      {NewTreeModal}

      {variant === 'dropdown' && open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" tabIndex={-1} />
          <div ref={menuRef} role="menu" aria-label={t('switch_tree')} onKeyDown={onMenuKeyDown}
            className="absolute right-0 mt-2 w-72 z-50 bg-card rounded-2xl shadow-lg border border-border p-2 nav-anim-fade-up">
            {RowList}
          </div>
        </>
      )}

      {variant === 'sheet' && (
        <Sheet open={open} onClose={() => setOpen(false)} title={t('switch_tree')}>
          {RowList}
        </Sheet>
      )}
    </div>
  );
}

/** "Owner · 1,204 people · 412 families", from the home page's cached read of the tree. */
function TreeCounts({ access }: { access: string | null }) {
  const th = useTranslations('home');
  const { activeTreeId, currentUserId } = useTree();
  const dash = useCachedResource(
    currentUserId === null ? null : `dashboard:get:tree=${activeTreeId ?? 'default'}`,
    async () => (await getDataClient()).dashboard.get(activeTreeId),
  );
  const stats = dash.data?.stats;
  return (
    <span className="text-meta text-white/75 truncate">
      {access}
      {access && stats && ' · '}
      {stats && th.rich('mobile_counts', {
        people: stats.people,
        families: stats.families,
        b: (chunks) => <span className="font-mono text-evidence">{chunks}</span>,
      })}
    </span>
  );
}
