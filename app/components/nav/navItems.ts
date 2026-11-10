import {
  Users, Heart, Network, BookOpen, MapPin, FolderSearch, Settings, Home,
  LinkIcon, Package, ClipboardList, CalendarDays,
} from '@/lib/icons';
import type { LucideIcon } from '@/lib/icons';

export type Permission = 'owner' | 'edit' | 'contribute' | 'view';

export interface NavItem { href: string; labelKey: string; icon: LucideIcon; exact?: boolean; }

/** Five everyday destinations (bottom bar + desktop). 'more' is mobile-only. */
export const PRIMARY_DESTINATIONS: NavItem[] = [
  { href: '/people',    labelKey: 'people',    icon: Users },
  { href: '/families',  labelKey: 'families',  icon: Heart },
  { href: '/tree',      labelKey: 'tree',      icon: Network },
  { href: '/library',   labelKey: 'library',   icon: BookOpen },
];

/** Desktop also surfaces these as top-level links; mobile puts them in the More sheet. */
export const SECONDARY_DESTINATIONS: NavItem[] = [
  { href: '/places', labelKey: 'places', icon: MapPin },
  { href: '/cases',  labelKey: 'cases',  icon: FolderSearch },
];

/** Phone drawer only: the redesigned phone screens hide the app top bar, whose brand links home. */
export const HOME_ITEM: NavItem = { href: '/', labelKey: 'home_nav', icon: Home, exact: true };

export const OPTIONS_ITEM: NavItem = { href: '/options', labelKey: 'options_nav', icon: Settings };

export const UTILITY_ITEMS: NavItem[] = [
  { href: '/relationship',  labelKey: 'relationship_trace', icon: LinkIcon },
  { href: '/import-export', labelKey: 'import_export',      icon: Package },
  { href: '/audit',         labelKey: 'audit_log',          icon: ClipboardList },
  { href: '/data-checks',   labelKey: 'data_checks',        icon: CalendarDays },
];

/** Pure: which pill style a tree row gets. Both render as neutral pills now (#688);
 *  the variant only distinguishes the "Owner" vs shared-permission label. */
export function permissionPillVariant(p: Permission): 'owner' | 'shared' {
  return p === 'owner' ? 'owner' : 'shared';
}

/**
 * Pure: is `pathname` "on" this nav item? `exact` items match only their own
 * path; the rest match any sub-route (so `/people/view/3` lights up `/people`).
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}
