/** Maps the `PlaceRole` string derived in the list/detail queries
 *  ('born' | 'died' | 'born & died') to an i18n key stem for the "…here"
 *  subtitle on a place's people list. Returns null for an unknown role
 *  (caller falls back to the raw string). Consumers render
 *  `t('places.role_' + placeRoleKey(role))`. */
export function placeRoleLabel(role: string, t: (key: string) => string): string {
  const key = placeRoleKey(role);
  // Unknown role → the raw string, which is at least data rather than a blank.
  return key ? t(`role_${key}`) : role;
}

export function placeRoleKey(role: string): 'born_here' | 'died_here' | 'born_died_here' | null {
  switch (role) {
    case 'born & died':
      return 'born_died_here';
    case 'born':
      return 'born_here';
    case 'died':
      return 'died_here';
    default:
      return null;
  }
}
