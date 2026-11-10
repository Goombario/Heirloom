/**
 * Engraved-monogram portrait placeholder — shown in the hero frame when a
 * person has no primary photo. Keeps the person's initials (identity cue);
 * the sex tint on the outer frame is intentionally subtle and secondary, so
 * the placeholder never relies on colour alone (red-green-colourblind safe).
 *
 * Warm "aged paper" colours are hardcoded on purpose — a bookplate reads the
 * same in light and dark, framed against the hero like a real photo would be.
 */

interface MonogramPortraitProps {
    /** Already-computed initials (e.g. from getInitials). */
    initials: string;
    /** 'M' | 'F' | 'X' | null — drives the subtle frame tint only. */
    sex: string | null;
    /** Accessible name for the placeholder (e.g. the person's full name). */
    label: string;
    /** Rendered px (square). */
    size?: number;
}

const FRAME_TINT: Record<string, string> = {
    M: 'var(--color-male)',
    F: 'var(--color-female)',
    X: 'var(--color-nonbinary)',
};

export default function MonogramPortrait({ initials, sex, label, size = 150 }: MonogramPortraitProps) {
    const tint = (sex && FRAME_TINT[sex]) || 'var(--color-neutral)';
    return (
        <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={label} style={{ display: 'block' }}>
            <rect width="200" height="200" fill="#F6EFE0" />
            {[74, 62, 50].map((r, i) => (
                <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="#9A4708" strokeOpacity={0.12 + i * 0.05} strokeWidth="1" />
            ))}
            {/* Sex-tinted outer frame — subtle, secondary to the initials. */}
            <rect x="14" y="14" width="172" height="172" fill="none" stroke={tint} strokeOpacity="0.55" strokeWidth="1.5" />
            <rect x="20" y="20" width="160" height="160" fill="none" stroke="#9A4708" strokeOpacity="0.25" strokeWidth="1" />
            <text
                x="100" y="100" textAnchor="middle" dominantBaseline="central"
                fontFamily="var(--font-fraunces), var(--font-literata), Georgia, serif" fontSize="76" fontWeight={600}
                fill="#7A3B08" letterSpacing="2"
            >
                {initials}
            </text>
        </svg>
    );
}
