/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import '@testing-library/jest-dom';
import en from '@/messages/en.json';

// Real messages, not a key-echoing stub: the three branches under test are all
// about what the reader ends up seeing (a capped list, a "+N more facts" tail, a
// "· Sub-place" attribution), so asserting on the rendered English is the only
// assertion that would actually catch them regressing.
vi.mock('@/app/components/LanguageProvider', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

const detail = vi.fn();
vi.mock('@/lib/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data')>()),
  getDataClient: async () => ({ places: { detail } }) as unknown as Awaited<
    ReturnType<typeof import('@/lib/data').getDataClient>
  >,
}));

import { ExploreDetail } from '@/app/places/explore/ExploreDetail';

type Fact = {
  personId: number;
  name: string;
  sex: string | null;
  primaryMediaId: number | null;
  kind: string;
  eventType: string | null;
  date: string | null;
  placeName: string;
};

/** Minimal PlaceDetail carrying only what the People column reads. */
function payload(name: string, factLinks: Fact[]) {
  return {
    name,
    people: [],
    factLinks,
    eventCounts: [],
    eventCount: 0,
    familyCount: 0,
    latitude: null,
    longitude: null,
    displayName: null,
    id: 1,
    form: null,
    parents: [],
    children: [],
  };
}

function renderDetail(placeName: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ExploreDetail placeName={placeName} treeId={null} />
    </NextIntlClientProvider>,
  );
}

/** The person entry anchors, in render order (the trailing overflow link is not one). */
function personLinks(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="/people/view?id="]'));
}

describe('ExploreDetail — grouped person entries', () => {
  beforeEach(() => detail.mockReset());

  describe('reason capping', () => {
    beforeEach(() => {
      // Five facts for ONE person, deliberately supplied out of order — the pane
      // renders whatever order groupFactLinks returns (earliest first), so the
      // three that survive the cap are the three EARLIEST, not the first three
      // the service happened to emit.
      detail.mockResolvedValue(
        payload('Ashwell, Rutland', [
          { personId: 1, name: 'Mabel Thorne', sex: 'F', primaryMediaId: null, kind: 'death', eventType: null, date: '1970', placeName: 'Ashwell, Rutland' },
          { personId: 1, name: 'Mabel Thorne', sex: 'F', primaryMediaId: null, kind: 'birth', eventType: null, date: '1900', placeName: 'Ashwell, Rutland' },
          { personId: 1, name: 'Mabel Thorne', sex: 'F', primaryMediaId: null, kind: 'event', eventType: 'OCCU', date: '1940', placeName: 'Ashwell, Rutland' },
          { personId: 1, name: 'Mabel Thorne', sex: 'F', primaryMediaId: null, kind: 'marriage', eventType: null, date: '1920', placeName: 'Ashwell, Rutland' },
          { personId: 1, name: 'Mabel Thorne', sex: 'F', primaryMediaId: null, kind: 'event', eventType: 'RESI', date: '1930', placeName: 'Ashwell, Rutland' },
        ]),
      );
    });

    it('says the name once, however many facts tie the person to the place', async () => {
      const { container } = renderDetail('Ashwell, Rutland');
      await waitFor(() => expect(personLinks(container)).toHaveLength(1));
      expect(screen.getAllByText('Mabel Thorne')).toHaveLength(1);
    });

    it('shows only the three earliest reasons', async () => {
      const { container } = renderDetail('Ashwell, Rutland');
      await waitFor(() => expect(personLinks(container)).toHaveLength(1));
      const entry = within(personLinks(container)[0]);

      expect(entry.getByText(/Born here/)).toBeInTheDocument();
      expect(entry.getByText(/Married here/)).toBeInTheDocument();
      expect(entry.getByText(/Resided here/)).toBeInTheDocument();
      // 1940 and 1970 fall past the cap.
      expect(entry.queryByText(/Died here/)).not.toBeInTheDocument();
    });

    it('tails the capped reasons with a translated count of the rest', async () => {
      const { container } = renderDetail('Ashwell, Rutland');
      await waitFor(() => expect(personLinks(container)).toHaveLength(1));
      expect(within(personLinks(container)[0]).getByText('2 more facts')).toBeInTheDocument();
    });

    it('omits the tail when every fact fits', async () => {
      detail.mockResolvedValue(
        payload('Bramfield', [
          { personId: 4, name: 'Owen Pell', sex: 'M', primaryMediaId: null, kind: 'birth', eventType: null, date: '1881', placeName: 'Bramfield' },
        ]),
      );
      const { container } = renderDetail('Bramfield');
      await waitFor(() => expect(personLinks(container)).toHaveLength(1));
      expect(within(personLinks(container)[0]).queryByText(/more fact/)).not.toBeInTheDocument();
    });
  });

  describe('sub-place attribution', () => {
    beforeEach(() => {
      // A rolled-up jurisdiction: the first person's fact happened in a
      // DESCENDANT place, the second's directly in the selected one.
      detail.mockResolvedValue(
        payload('Kent, England', [
          { personId: 2, name: 'Alice Ferrers', sex: 'F', primaryMediaId: null, kind: 'birth', eventType: null, date: '1888', placeName: 'Buckland, Kent, England' },
          { personId: 3, name: 'Hugh Ferrers', sex: 'M', primaryMediaId: null, kind: 'birth', eventType: null, date: '1890', placeName: 'Kent, England' },
        ]),
      );
    });

    it('names the sub-place a rolled-up fact came from', async () => {
      const { container } = renderDetail('Kent, England');
      await waitFor(() => expect(personLinks(container)).toHaveLength(2));
      // The leaf name only, not the full "Buckland, Kent, England" string.
      expect(within(personLinks(container)[0]).getByText('· Buckland')).toBeInTheDocument();
    });

    it('adds no suffix when the fact already sits at the selected place', async () => {
      const { container } = renderDetail('Kent, England');
      await waitFor(() => expect(personLinks(container)).toHaveLength(2));
      expect(personLinks(container)[1].textContent).not.toContain('·');
    });
  });

  describe('preview cap on PEOPLE', () => {
    it('renders 60 people and links to the full page for the rest', async () => {
      const links: Fact[] = Array.from({ length: 61 }, (_, i) => ({
        personId: i + 1,
        name: `Person ${i + 1}`,
        sex: null,
        primaryMediaId: null,
        kind: 'birth',
        eventType: null,
        date: '1900',
        placeName: 'Wolds, Nottinghamshire',
      }));
      detail.mockResolvedValue(payload('Wolds, Nottinghamshire', links));

      const { container } = renderDetail('Wolds, Nottinghamshire');
      // Five rows first; "Show all" expands in place (#56), still capped at
      // MAX_PREVIEW_PEOPLE. The count in the link is PEOPLE, not facts — the bug
      // the cap change fixed was 60 rows being a dozen people.
      await waitFor(() => expect(personLinks(container)).toHaveLength(5));
      fireEvent.click(screen.getByRole('button', { name: /Show all 61/ }));
      expect(personLinks(container)).toHaveLength(60);
      expect(
        screen.getByText('Showing 60 of 61 people — open the full page'),
      ).toBeInTheDocument();
    });

    it('shows no overflow link when everyone fits', async () => {
      detail.mockResolvedValue(
        payload('Stert', [
          { personId: 9, name: 'Edith Vane', sex: 'F', primaryMediaId: null, kind: 'birth', eventType: null, date: '1902', placeName: 'Stert' },
        ]),
      );
      const { container } = renderDetail('Stert');
      await waitFor(() => expect(personLinks(container)).toHaveLength(1));
      expect(screen.queryByText(/open the full page/)).not.toBeInTheDocument();
    });
  });
});
