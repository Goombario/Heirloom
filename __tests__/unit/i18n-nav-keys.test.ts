import { describe, it, expect } from 'vitest';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import ru from '@/messages/ru.json';

const REQUIRED_NAV_KEYS = [
  'more', 'switch_tree', 'switch_tree_named', 'manage_sharing', 'my_tree', 'shared_with_me',
  'perm_owner', 'perm_edit', 'perm_contribute', 'perm_view', 'options_nav',
];
const REQUIRED_USERMENU_KEYS = ['account', 'sign_out', 'options'];

describe('nav i18n completeness', () => {
  for (const [name, msgs] of Object.entries({ en, fr, ru })) {
    it(`${name} has all required nav keys`, () => {
      for (const k of REQUIRED_NAV_KEYS) {
        expect((msgs.nav as Record<string, string>)[k], `nav.${k} missing in ${name}`).toBeTruthy();
      }
    });
    it(`${name} has all required userMenu keys`, () => {
      for (const k of REQUIRED_USERMENU_KEYS) {
        expect((msgs.userMenu as Record<string, string>)[k], `userMenu.${k} missing in ${name}`).toBeTruthy();
      }
    });
  }
});
