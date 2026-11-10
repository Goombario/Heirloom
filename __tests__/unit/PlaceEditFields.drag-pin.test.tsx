/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import PlaceEditFields from '@/app/places/view/PlaceEditFields';

/**
 * #566: a dragged pin writes the coordinates field, and the field says so. The pin can
 * then sit off the geocoder's own coordinate — a manual refinement inside the matched
 * place, which keeps DisplayName and the OSM ids and so must be STATED rather than
 * silently retained.
 */
function renderFields(over: Partial<React.ComponentProps<typeof PlaceEditFields>> = {}) {
  return render(
    <PlaceEditFields
      placeName="London"
      displayName="London, England, United Kingdom"
      coordsValue="51.5, -0.12"
      onCoordsChange={() => {}}
      coordsError={null}
      nameValue="London"
      onNameChange={() => {}}
      otherPlaces={[]}
      onApplyName={() => {}}
      renaming={false}
      {...over}
    />,
  );
}

describe('PlaceEditFields — drag-pin affordance and divergence (#566)', () => {
  it('mentions the pin in the coordinates hint only when there is a pin to drag', () => {
    const { unmount } = renderFields({ draggableHint: true });
    expect(screen.getByText('coords_help_draggable')).toBeInTheDocument();
    unmount();

    renderFields({ draggableHint: false });
    expect(screen.getByText('coords_help')).toBeInTheDocument();
    expect(screen.queryByText('coords_help_draggable')).toBeNull();
  });

  it('keeps the validation error in place of any hint', () => {
    // The error is the more urgent message and the field can only carry one.
    renderFields({ draggableHint: true, coordsError: 'invalid_coords' });
    expect(screen.getByRole('alert')).toHaveTextContent('invalid_coords');
    expect(screen.queryByText('coords_help_draggable')).toBeNull();
  });

  it('states that the pin was moved by hand, without calling it an error', () => {
    renderFields({ pinAdjusted: true });
    const note = screen.getByText('pin_adjusted');
    expect(note).toBeInTheDocument();
    // Not an alert, and not the error colour: the match is still valid.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(note.closest('p')).not.toHaveClass('text-error');
  });

  it('says nothing while the pin still sits where the geocoder put it', () => {
    renderFields({ pinAdjusted: false });
    expect(screen.queryByText('pin_adjusted')).toBeNull();
  });

  it('keeps the divergence note with the geocoded field it qualifies', () => {
    renderFields({ pinAdjusted: true });
    const geocoded = screen.getByLabelText('geocoded_as');
    const note = screen.getByText('pin_adjusted');
    // Same group as "Geocoded as" — the note is about that match, not the number field.
    expect(geocoded.closest('div')?.parentElement?.contains(note)).toBe(true);
  });
});
