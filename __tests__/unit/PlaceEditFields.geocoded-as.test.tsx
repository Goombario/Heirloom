/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import PlaceEditFields from '@/app/places/view/PlaceEditFields';

/**
 * Release-readiness tracker §13.3 follow-up: "Geocoded as" holds REAL data
 * (Places.DisplayName — what the geocoder actually matched, shipped 2026-07-10),
 * so it must not render inside the greyed-out "Coming soon" block alongside the
 * deferred aliases placeholder. It stays read-only (sourced from the geocoder,
 * never hand-edited) but must not be `disabled` — disabled fields are skipped
 * by screen readers and read as "not implemented".
 *
 * Updated for #447's regrouping: the form is now three labelled groups, and the
 * Location group is itself a bordered `.pt-4` section, so the original "not inside
 * any .pt-4" check no longer expresses the rule. The rule was never about that
 * class — it is "Geocoded as belongs with the coordinates it describes, and NOT in
 * the deferred group" — so it is asserted that way here instead.
 */
function renderFields(displayName: string | null) {
  return render(
    <PlaceEditFields
      placeName="London"
      displayName={displayName}
      coordsValue="51.5, -0.12"
      onCoordsChange={() => {}}
      coordsError={null}
      nameValue="London"
      onNameChange={() => {}}
      otherPlaces={[]}
      onApplyName={() => {}}
      renaming={false}
    />,
  );
}

/** The nearest enclosing field group — the three top-level children of the form. */
function groupOf(el: HTMLElement): HTMLElement {
  const group = el.closest('.space-y-5 > div');
  expect(group).not.toBeNull();
  return group as HTMLElement;
}

describe('PlaceEditFields — "Geocoded as" placement (§13.3, regrouped by #447)', () => {
  it('renders read-only but NOT disabled', () => {
    renderFields('London, England, United Kingdom');
    const geocoded = screen.getByLabelText('geocoded_as');
    expect(geocoded).toHaveAttribute('readonly');
    expect(geocoded).not.toBeDisabled();
    expect(geocoded).toHaveValue('London, England, United Kingdom');
  });

  it('sits in the Location group, beside the coordinates it names', () => {
    renderFields('London, England, United Kingdom');
    const geocoded = screen.getByLabelText('geocoded_as');
    // Regex, not an exact string: `Input` puts the hint inside the <label>, so the
    // accessible name of a hinted field is "coordinates" followed by its hint.
    const coords = screen.getByLabelText(/^coordinates/);

    const group = groupOf(geocoded);
    expect(group).toBe(groupOf(coords));
    expect(group).toHaveTextContent('group_location');
  });

  it('falls back to an em-dash when no geocoded name exists', () => {
    renderFields(null);
    expect(screen.getByLabelText('geocoded_as')).toHaveValue('—');
  });
});
