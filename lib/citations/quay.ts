/**
 * GEDCOM 5.5.1 QUAY (certainty assessment) values, ordered highest → lowest
 * reliability. Stored as the bare string digit on `Citation.Quay`.
 *
 *   3 = primary evidence      2 = secondary evidence
 *   1 = questionable          0 = unreliable
 */
export const QUAY_VALUES = ['3', '2', '1', '0'] as const;
export type QuayValue = (typeof QUAY_VALUES)[number];

export function isQuayValue(value: unknown): value is QuayValue {
  return typeof value === 'string' && (QUAY_VALUES as readonly string[]).includes(value);
}

/** i18n key (under the `library` namespace) for each QUAY level's label. */
export const QUAY_LABEL_KEY: Record<QuayValue, string> = {
  '3': 'certainty_3',
  '2': 'certainty_2',
  '1': 'certainty_1',
  '0': 'certainty_0',
};
