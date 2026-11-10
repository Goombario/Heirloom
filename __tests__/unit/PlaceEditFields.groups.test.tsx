/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import PlaceEditFields from '@/app/places/view/PlaceEditFields';

/**
 * #447 + ADR 0017. Two rules the form has broken before and must not break again:
 *
 *  1. Places.Name is labelled "Place name" — never "Canonical" (what shipped) and
 *     never "Display name" (what the issue asked for, which collides with the
 *     Places.DisplayName column already on this same form).
 *  2. The fields are grouped, and the grouping is LABELLED. "Geocoded as" being
 *     adjacent to the coordinates is not enough on its own — #393 was filed
 *     because it sat next to a heading that said the field was not implemented.
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

describe('PlaceEditFields — three labelled groups (#447)', () => {
  it('labels Places.Name "Place name", and does not use the retired labels', () => {
    renderFields();
    expect(screen.getByLabelText(/^place_name/)).toHaveValue('London');
    // The two names the ADR forbids. `canonical` no longer exists as a key at all,
    // so the mocked translator echoing it would be the only way it could appear.
    expect(screen.queryByText('canonical')).toBeNull();
  });

  it('renders Identity → Location, in that order, and no Alternate-names group', () => {
    renderFields();
    const headings = ['group_identity', 'group_location']
      .map((key) => screen.getByText(key));
    // Source order is reading order here: the groups are stacked block children.
    for (let i = 1; i < headings.length; i++) {
      expect(
        headings[i - 1].compareDocumentPosition(headings[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // ADR 0031: a place's other names wait on PlaceId normalization (#1167).
    expect(screen.queryByText('group_alternate_names')).toBeNull();
  });

  it('keeps the rename/merge control with the name it applies to', () => {
    renderFields({ nameValue: 'Londres' });
    const identity = screen.getByText('group_identity').closest('.space-y-5 > div');
    expect(identity).not.toBeNull();
    expect(identity!.contains(screen.getByLabelText(/^place_name/))).toBe(true);
    expect(identity!).toHaveTextContent('rename_to');
  });

  it('puts Other names last, when the page passes its editor (#1185)', () => {
    renderFields({ otherNames: <p>names editor</p> });
    const heading = screen.getByText('other_names');
    expect(screen.getByText('group_location').compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.closest('.space-y-5 > div')).toHaveTextContent('names editor');
  });

  it('offers Re-match only when the caller can perform one', () => {
    const { unmount } = renderFields();
    expect(screen.queryByRole('button', { name: /rematch/ })).toBeNull();
    unmount();

    renderFields({ onRematch: () => {} });
    expect(screen.getByRole('button', { name: /rematch/ })).toBeInTheDocument();
  });

  it('keeps "Geocoded as" read-only even with Re-match available — the fix is a re-match, not typing', () => {
    renderFields({ onRematch: () => {} });
    expect(screen.getByLabelText('geocoded_as')).toHaveAttribute('readonly');
  });
});
