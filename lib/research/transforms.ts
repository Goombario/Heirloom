/**
 * The named transforms a site can apply to a query value before sending it
 * (#1017 section 3; #1026). A site needing a new one adds it here, with a test.
 *
 * Every transform takes the value as a string and returns a string; an empty
 * value is never transformed, so a missing detail stays missing.
 */

export type Transform =
    /** `Hollis` → `HOLLIS`. */
    | { name: 'upper' }
    /** A year → its first day, `1930` → `1930-01-01`. */
    | { name: 'isoYearStart' }
    /** A year → its last day, `1932` → `1932-12-31`. */
    | { name: 'isoYearEnd' }
    /** A year held within a collection's span. */
    | { name: 'clampYear'; min?: number; max?: number }
    /** A number → the smallest step at least as large, or the largest step (Find a Grave's ±1/3/5/10/25). */
    | { name: 'roundToSteps'; steps: number[] }
    /** A leading word removed, ignoring case: `County Cork` → `Cork` with `{ prefixes: ['County '] }`. */
    | { name: 'stripPrefix'; prefixes: string[] }
    /** The value placed in a template: `{ template: 'Mrs. {value}' }`. */
    | { name: 'format'; template: string };

type TransformName = Transform['name'];
type Apply<N extends TransformName> = (value: string, options: Extract<Transform, { name: N }>) => string;

const TRANSFORMS: { [N in TransformName]: Apply<N> } = {
    upper: value => value.toUpperCase(),
    isoYearStart: value => `${value.padStart(4, '0')}-01-01`,
    isoYearEnd: value => `${value.padStart(4, '0')}-12-31`,
    clampYear: (value, { min = -Infinity, max = Infinity }) => String(Math.min(Math.max(Number(value), min), max)),
    roundToSteps: (value, { steps }) => String(steps.find(step => step >= Number(value)) ?? steps[steps.length - 1]),
    stripPrefix: (value, { prefixes }) => {
        const prefix = prefixes.find(p => value.toLowerCase().startsWith(p.toLowerCase()));
        return prefix ? value.slice(prefix.length).trim() : value;
    },
    format: (value, { template }) => template.replace('{value}', value),
};

export const TRANSFORM_NAMES = Object.keys(TRANSFORMS) as TransformName[];

export function applyTransforms(value: string, transforms: Transform | Transform[] | undefined): string {
    if (!value || !transforms) return value;
    return (Array.isArray(transforms) ? transforms : [transforms])
        .reduce((v, t) => (TRANSFORMS[t.name] as Apply<typeof t.name>)(v, t as never), value);
}
