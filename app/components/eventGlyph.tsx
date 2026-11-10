/**
 * Maps a GEDCOM-style event type code to a medallion glyph for the Timeline.
 * Shared by the person life-events timeline and (later) the family timeline,
 * so the icon vocabulary stays consistent across surfaces.
 */
import {
    Sprout, Flower2, Home, Ship, Stamp, Briefcase, GraduationCap, Droplets,
    HeartHandshake, Armchair, Scale, ScrollText, Landmark, Heart, MapPin,
    CalendarDays, HeartCrack, FileText,
} from '@/lib/icons';
import type { LucideIcon } from '@/lib/icons';

interface GlyphSpec {
    icon: LucideIcon;
    /** Deceased-state events render dimmed to read as the end of the arc. */
    dim?: boolean;
}

const GLYPHS: Record<string, GlyphSpec> = {
    BIRT: { icon: Sprout },
    DEAT: { icon: Flower2, dim: true },
    BURI: { icon: Flower2, dim: true },
    MARR: { icon: Heart },
    RESI: { icon: Home },
    EMIG: { icon: Ship },
    IMMI: { icon: Ship },
    NATU: { icon: Stamp },
    OCCU: { icon: Briefcase },
    EDUC: { icon: GraduationCap },
    GRAD: { icon: GraduationCap },
    CENS: { icon: Landmark },
    BAPM: { icon: Droplets },
    CHR: { icon: Droplets },
    ADOP: { icon: HeartHandshake },
    RETI: { icon: Armchair },
    PROB: { icon: Scale },
    WILL: { icon: ScrollText },
    EVEN: { icon: CalendarDays },
    // Family life-cycle events
    ENGA: { icon: HeartHandshake },   // engagement
    MARB: { icon: ScrollText },       // marriage banns
    MARC: { icon: FileText },         // marriage contract
    MARL: { icon: Stamp },            // marriage license
    MARS: { icon: Scale },            // marriage settlement
    DIV: { icon: HeartCrack, dim: true },   // divorce (an ending)
    DIVF: { icon: FileText, dim: true },     // divorce filed
    ANUL: { icon: HeartCrack, dim: true },   // annulment
    SEPA: { icon: HeartCrack, dim: true },   // separation (custom)
};

export function eventGlyph(type: string): { Icon: LucideIcon; dim: boolean } {
    const spec = GLYPHS[type] ?? { icon: MapPin };
    return { Icon: spec.icon, dim: spec.dim ?? false };
}
