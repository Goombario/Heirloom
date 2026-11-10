/**
 * Single source of truth for the person Sex → avatar gradient class mapping.
 *
 * The gradient classes (`avatar-male` / `avatar-female` / `avatar-nonbinary` /
 * `avatar-neutral`) are defined in `app/globals.css` and driven by the muted,
 * colourblind-safe `--color-{male,female,nonbinary,neutral}` tokens. Every
 * avatar surface — the shared `PersonAvatar`, `ui/Avatar`, the person-detail
 * hero, list rows, pickers, and the places face-stacks — routes through here so
 * the sex→colour rule (and the non-binary branch) lives in exactly one place.
 *
 * `Sex` is stored as a free-form string (`'M'` / `'F'` / `'X'` / null); any
 * value that isn't a recognised code falls back to the neutral disc.
 */
export function avatarClass(sex: string | null | undefined): string {
    if (sex === 'M') return 'avatar-male';
    if (sex === 'F') return 'avatar-female';
    if (sex === 'X') return 'avatar-nonbinary';
    return 'avatar-neutral';
}
