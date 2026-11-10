/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ReactNode } from 'react';
import type { FaceGroup } from '@/lib/data/types';
import type { FaceMatchKind, MediaFaceCandidate } from '@/lib/db/schema';

const harness = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  useFaceQueue: vi.fn(),
  confirm: vi.fn(async (ids: number[]) => ({ results: ids.map(candidateId => ({ candidateId, status: 'confirmed', tagId: 1 })) })),
  dismiss: vi.fn(async (ids: number[]) => ({ dismissed: ids.length })),
  undo: vi.fn(async () => ({ restored: 0, skipped: 0 })),
  reload: vi.fn(async () => undefined),
  info: vi.fn(),
  success: vi.fn(),
  tree: {
    activeTreeId: 7 as number | null,
    activePermission: 'edit',
    currentUserId: 42 as number | null,
  },
  pending: {
    groups: [] as FaceGroup[],
    pendingTotal: 0,
    resolvedTotal: 0,
    loading: false,
    error: null as string | null,
  },
  resolved: {
    groups: [] as FaceGroup[],
    pendingTotal: 0,
    resolvedTotal: 0,
    loading: false,
    error: null as string | null,
  },
}));

const translations: Record<string, string> = {
  queue_title: 'Faces from photo metadata',
  queue_resolved_title: 'Recently resolved faces',
  queue_resolved_subtitle: '{count} faces resolved recently',
  queue_banner: 'Check who each one is, then tag.',
  queue_empty_title: 'All caught up',
  queue_empty_body: 'Every detected face has been reviewed.',
  queue_empty_action_resolved: 'View recently resolved',
  queue_resolved_empty_body: 'Resolved faces will appear here for a short time.',
  filter_pending: 'Waiting',
  filter_resolved_short: 'Resolved',
  filter_label: 'Filter faces by status',
  panel_label: 'Faces waiting',
  rail_summary: '{faces} faces waiting · {groups} groups',
  rail_jump_to: 'Jump to',
  group_faces_count: '{count} faces',
  group_faces_photos: '{faces} faces · {photos} photos',
  match_matched: 'Matched',
  match_via_variant: 'Similar name',
  match_ambiguous: '{count} people share this name',
  match_needs_name: 'Needs a name',
  match_chosen: 'You chose',
  action_confirm_all: 'Confirm all {count} matches',
  action_tag: 'Tag {count}',
  action_choose_person: 'Choose person…',
  action_someone_else: 'Someone else…',
  action_each_face: 'Choose for each face',
  action_cant_identify_all: "Can't identify all {count}",
  action_none_faces: 'None of these are faces',
  action_not_person: 'Not {name}',
  action_not_a_face: 'Not a face',
  action_cant_identify_one: "Can't identify this one",
  ambiguous_candidates_label: 'Choose which person these faces show',
  face_options: 'Options for this face',
  row_more: 'More for {name}',
  face_of: 'Face {index} of {of} named “{name}”',
  split_not: 'Split off: not {name}',
  note_span: 'These photos run from {from} to {to}, and {name} was born in {born}.',
  note_likely: '{out} was born after this {year} photo, so this is likely {likely}.',
  settled_tagged: 'Tagged {count} faces as {name}',
  show_photo: 'Show the photo: {title}',
  unknown: 'Unknown',
};

function translate(key: string, values?: Record<string, unknown>) {
  let value = translations[key] ?? key;
  for (const [name, replacement] of Object.entries(values ?? {})) {
    if (typeof replacement !== 'function') value = value.replace(`{${name}}`, String(replacement));
  }
  return value;
}

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: harness.push, replace: harness.replace }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign(translate, { rich: translate }),
}));

vi.mock('@/app/contexts/TreeContext', () => ({
  useTree: () => harness.tree,
}));

vi.mock('@/app/library/faces/useFaceQueue', () => ({
  useFaceQueue: (treeId: number | null, resolved: boolean) => {
    harness.useFaceQueue(treeId, resolved);
    const queue = resolved ? harness.resolved : harness.pending;
    return { ...queue, confirm: harness.confirm, dismiss: harness.dismiss, undo: harness.undo, reload: harness.reload };
  },
}));

vi.mock('@/lib/data', () => ({
  getDataClient: vi.fn(),
}));

vi.mock('@/app/components/MediaImg', () => ({
  default: () => null,
}));

vi.mock('@/app/components/lightbox/MediaLightbox', () => ({ default: () => null }));

// Search over everyone is its own component; here it picks "Bea Searched" in one click.
vi.mock('@/app/components/PersonPicker', () => ({
  default: ({ onChange }: { onChange: (p: unknown) => void }) => (
    <button type="button" onClick={() => onChange({ Id: 77, FirstName: 'Bea', LastName: 'Searched', Sex: 'F', BirthDate: '1920', DeathDate: null })}>
      search-pick
    </button>
  ),
}));

vi.mock('@/app/components/ui', async () => ({
  ...(await vi.importActual<typeof import('@/app/components/ui')>('@/app/components/ui')),
  showSuccessToast: harness.success,
  showInfoToast: harness.info,
  showErrorToast: vi.fn(),
}));

import FacesPanel from '@/app/library/faces/FacesPanel';
import FacesPage from '@/app/library/faces/page';

function makeCandidate(id: number, matchKind: FaceMatchKind, sourceName: string | null, mediaDate: string | null = null): MediaFaceCandidate {
  return {
    Id: id,
    MediaId: 100 + id,
    TreeId: 7,
    RegionX: 10,
    RegionY: 12,
    RegionW: 20,
    RegionH: 24,
    SourceName: sourceName,
    SuggestedPersonId: matchKind === 'ambiguous' || matchKind === 'none' ? null : 1000 + id,
    MatchKind: matchKind,
    Status: 'pending',
    ConfirmedTagId: null,
    DismissReason: null,
    MediaTitle: `Photo ${id}`,
    MediaDate: mediaDate,
    MediaPeopleCount: 3,
  };
}

function person(id: number, name: string, birthYear: string | null) {
  return { id, name, birthYear, deathYear: null, sex: null, mediaId: null, focalX: null, focalY: null, focalRadius: null };
}

function makeGroup(
  groupKey: string,
  matchKind: FaceMatchKind,
  candidateCount: number,
  { dates = [] as (string | null)[], sharedBy = [person(21, 'Marie Gagnon', '1905'), person(22, 'Marie Ellis', '1931')] } = {},
): FaceGroup {
  const sourceName = groupKey.split(':', 2)[1] || null;
  const matched = matchKind !== 'ambiguous' && matchKind !== 'none';
  return {
    groupKey,
    sourceName,
    matchKind,
    suggestedPerson: matched ? person(17, sourceName ?? 'Ada Example', '1902') : null,
    candidateCount,
    candidates: Array.from({ length: candidateCount }, (_, index) => (
      makeCandidate(Number(`${candidateCount}${index + 1}`), matchKind, sourceName, dates[index] ?? null)
    )),
    ambiguousPersonCount: matchKind === 'ambiguous' ? sharedBy.length : null,
    ambiguousCandidates: matchKind === 'ambiguous' ? sharedBy : [],
  };
}

async function renderReadyPage() {
  const result = render(<FacesPanel treeId={7} canEdit={harness.tree.activePermission !== 'view'} />);
  await screen.findByRole('heading', { name: /Faces from photo metadata|Recently resolved faces/ });
  return result;
}

const rowOf = (name: string) => screen.getByRole('heading', { name }).closest('[data-testid="face-row"]') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  harness.tree.activePermission = 'edit';
  Object.assign(harness.pending, { groups: [], pendingTotal: 0, resolvedTotal: 0, loading: false, error: null });
  Object.assign(harness.resolved, { groups: [], pendingTotal: 0, resolvedTotal: 0, loading: false, error: null });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
});

describe('Faces decision rows (#1156)', () => {
  it('puts the queue in the floating panel, and Confirm all counts known people but never shared names', async () => {
    harness.pending.groups = [
      makeGroup('name:Exact', 'exact', 2),
      makeGroup('name:Variant', 'variant', 1),
      makeGroup('name:Chosen', 'chosen', 3),
      makeGroup('name:Marie', 'ambiguous', 2),
      makeGroup('name:Unnamed', 'none', 1),
    ];
    harness.pending.pendingTotal = 9;

    await renderReadyPage();

    const panel = screen.getByRole('complementary', { name: 'Faces waiting' });
    expect(within(panel).getByRole('heading', { name: '9 faces waiting · 5 groups' })).toBeInTheDocument();
    expect(within(panel).getAllByRole('link')).toHaveLength(5);
    expect(within(panel).getByRole('button', { name: 'Confirm all 6 matches' })).toHaveClass('bg-primary');
    expect(screen.getAllByRole('button', { name: /Confirm all/ })).toHaveLength(1);

    expect(within(rowOf('Variant')).getByText('Similar name')).toBeInTheDocument();
    expect(within(rowOf('Exact')).getByText('2 faces · 2 photos')).toBeInTheDocument();
    // Tag is the neutral outline, never copper.
    const tag = within(rowOf('Exact')).getByRole('button', { name: 'Tag 2' });
    expect(tag).not.toHaveClass('bg-primary');
    expect(within(rowOf('Unnamed')).getByRole('button', { name: 'Tag 1' })).toBeDisabled();
  });

  it('tags with the person on the row, then leaves a one-line summary with Undo', async () => {
    harness.pending.groups = [makeGroup('name:Thomas Ellis', 'exact', 2)];
    harness.pending.pendingTotal = 2;
    await renderReadyPage();

    fireEvent.click(within(rowOf('Thomas Ellis')).getByRole('button', { name: 'Tag 2' }));
    await waitFor(() => expect(harness.confirm).toHaveBeenCalledWith([21, 22], 17));
    harness.pending.groups = [];

    const summary = await screen.findByTestId('face-row-settled');
    expect(summary).toHaveTextContent('Tagged 2 faces as Thomas Ellis');
    fireEvent.click(within(summary).getByRole('button', { name: 'action_undo' }));
    await waitFor(() => expect(harness.undo).toHaveBeenCalledWith([21, 22]));
  });

  it('fills the row from the person picker and tags with that person, not the suggestion', async () => {
    harness.pending.groups = [makeGroup('name:Uncle Bill', 'none', 1)];
    harness.pending.pendingTotal = 1;
    await renderReadyPage();

    const row = rowOf('Uncle Bill');
    expect(within(row).getByText('Needs a name')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: /Choose person/ }));
    fireEvent.click(within(row).getByRole('button', { name: 'search-pick' }));

    expect(harness.confirm).not.toHaveBeenCalled();
    expect(within(row).getByText('You chose')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Tag 1' }));
    await waitFor(() => expect(harness.confirm).toHaveBeenCalledWith([11], 77));
  });

  it('keeps a shared name untagged until a person is picked, and notes when photos predate a candidate', async () => {
    harness.pending.groups = [makeGroup('name:Marie', 'ambiguous', 2, { dates: ['1926', '1958'] })];
    harness.pending.pendingTotal = 2;
    await renderReadyPage();

    const row = rowOf('Marie');
    expect(within(row).getByRole('button', { name: 'Tag 2' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Confirm all/ })).not.toBeInTheDocument();
    expect(within(row).getByText('These photos run from 1926 to 1958, and Marie Ellis was born in 1931.')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Choose for each face' })).toHaveClass('font-semibold');

    fireEvent.click(within(row).getByRole('radio', { name: /Marie Gagnon/ }));
    fireEvent.click(within(row).getByRole('button', { name: 'Tag 2' }));
    await waitFor(() => expect(harness.confirm).toHaveBeenCalledWith([21, 22], 21));
    // Picking makes it the user's own choice; Confirm all still leaves shared names alone.
    expect(screen.queryByRole('button', { name: /Confirm all/ })).not.toBeInTheDocument();
  });

  it('splits a shared name into one row per face, greys out a person born after that photo, and Undo joins them', async () => {
    harness.pending.groups = [makeGroup('name:Marie', 'ambiguous', 2, { dates: ['1926', '1958'] })];
    harness.pending.pendingTotal = 2;
    await renderReadyPage();

    fireEvent.click(within(rowOf('Marie')).getByRole('button', { name: 'Choose for each face' }));

    const rows = screen.getAllByTestId('face-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Face 1 of 2 named “Marie”');
    expect(within(rows[0]).getByRole('radio', { name: /Marie Ellis/ })).toBeDisabled();
    expect(within(rows[0]).getByText('Marie Ellis was born after this 1926 photo, so this is likely Marie Gagnon.')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('radio', { name: /Marie Ellis/ })).toBeEnabled();
    // Nothing is picked for the user.
    expect(within(rows[0]).getByRole('button', { name: 'Tag 1' })).toBeDisabled();

    const undo = harness.info.mock.calls.at(-1)?.[1] as { onClick: () => void };
    undo.onClick();
    await waitFor(() => expect(screen.getAllByTestId('face-row')).toHaveLength(1));
  });

  it('moves one face to its own row with Not {person}, and Undo puts it back', async () => {
    harness.pending.groups = [makeGroup('name:Thomas Ellis', 'exact', 3)];
    harness.pending.pendingTotal = 3;
    await renderReadyPage();

    const row = rowOf('Thomas Ellis');
    fireEvent.click(within(row).getAllByRole('button', { name: 'Options for this face' })[1]);
    fireEvent.click(screen.getByRole('menuitem', { name: /Not Thomas Ellis/ }));

    const rows = screen.getAllByTestId('face-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('button', { name: 'Tag 2' })).toBeEnabled();
    expect(rows[1]).toHaveTextContent('Split off: not Thomas Ellis');
    expect(within(rows[1]).getByText('Needs a name')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('button', { name: 'Tag 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm all 2 matches' })).toBeInTheDocument();

    const undo = harness.info.mock.calls.at(-1)?.[1] as { onClick: () => void };
    undo.onClick();
    await waitFor(() => expect(screen.getAllByTestId('face-row')).toHaveLength(1));
  });

  it('sets a whole row or one face aside from its menus', async () => {
    harness.pending.groups = [makeGroup('name:Ruth Ellis', 'exact', 2)];
    harness.pending.pendingTotal = 2;
    await renderReadyPage();

    const row = rowOf('Ruth Ellis');
    fireEvent.click(within(row).getByRole('button', { name: 'More for Ruth Ellis' }));
    fireEvent.click(screen.getByRole('menuitem', { name: "Can't identify all 2" }));
    await waitFor(() => expect(harness.dismiss).toHaveBeenCalledWith([21, 22], 'unidentified'));

    fireEvent.click(within(row).getAllByRole('button', { name: 'Options for this face' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Not a face' }));
    await waitFor(() => expect(harness.dismiss).toHaveBeenCalledWith([21], 'not-a-face'));
  });

  it('opens a face to show its photo', async () => {
    harness.pending.groups = [makeGroup('name:Ruth Ellis', 'exact', 1, { dates: ['1935'] })];
    harness.pending.pendingTotal = 1;
    await renderReadyPage();

    fireEvent.click(screen.getByRole('button', { name: 'Show the photo: Photo 11' }));
    const peek = screen.getByRole('dialog', { name: 'peek_label' });
    expect(peek).toHaveTextContent('Photo 11');
    expect(within(peek).getByText('peek_meta_year')).toBeInTheDocument();
  });

  it('gives viewers the rows without Tag, menus, face actions or Confirm all', async () => {
    harness.tree.activePermission = 'view';
    harness.pending.groups = [makeGroup('name:Exact', 'exact', 2), makeGroup('name:Marie', 'ambiguous', 2)];
    harness.pending.pendingTotal = 4;
    await renderReadyPage();

    expect(screen.queryByRole('button', { name: /Tag/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /More for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Options for this face' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm all/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose for each face' })).not.toBeInTheDocument();
    for (const radio of within(rowOf('Marie')).getAllByRole('radio')) expect(radio).toBeDisabled();
  });

  it('uses distinct pending and resolved headings and empty states', async () => {
    await renderReadyPage();
    expect(screen.getByText('Every detected face has been reviewed.')).toBeInTheDocument();

    // The empty queue links to what was just resolved (#1175).
    fireEvent.click(screen.getByRole('button', { name: 'View recently resolved' }));
    expect(await screen.findByRole('heading', { name: 'Recently resolved faces' })).toBeInTheDocument();
    expect(screen.getByText('0 faces resolved recently')).toBeInTheDocument();
    expect(screen.getByText('Resolved faces will appear here for a short time.')).toBeInTheDocument();
    expect(harness.useFaceQueue).toHaveBeenLastCalledWith(7, true);
  });

  it('lists resolved groups with Undo', async () => {
    harness.resolved.groups = [makeGroup('name:Resolved one', 'exact', 2), makeGroup('name:Resolved two', 'variant', 1)];
    await renderReadyPage();
    fireEvent.click(screen.getByRole('radio', { name: 'Resolved' }));

    expect(await screen.findByText('3 faces resolved recently')).toBeInTheDocument();
    const resolved = screen.getAllByTestId('face-row-resolved');
    expect(resolved).toHaveLength(2);
    fireEvent.click(within(resolved[0]).getByRole('button', { name: 'action_undo' }));
    await waitFor(() => expect(harness.undo).toHaveBeenCalledWith([21, 22]));
  });

  it('jumps to a stable row anchor, focuses it, and marks the panel row active', async () => {
    harness.pending.groups = [makeGroup('name:Ada Example', 'exact', 1)];
    harness.pending.pendingTotal = 1;
    await renderReadyPage();

    const row = rowOf('Ada Example');
    expect(row).toHaveAttribute('id', 'face-queue-group-name%3AAda%20Example');
    expect(row).toHaveClass('scroll-mt-[calc(var(--nav-h)+1.5rem)]');
    const jump = within(screen.getByRole('navigation', { name: 'Jump to' })).getByRole('link', { name: /Ada Example/ });
    expect(jump).toHaveAttribute('href', '#face-queue-group-name%3AAda%20Example');

    fireEvent.click(jump);
    expect(document.activeElement).toBe(row);
    await waitFor(() => expect(jump).toHaveAttribute('aria-current', 'true'));
  });

  it('preserves the loading shell and error banner', async () => {
    harness.pending.loading = true;
    const { container, unmount } = render(<FacesPanel treeId={7} canEdit />);
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');

    unmount();
    harness.pending.loading = false;
    harness.pending.error = 'load_failed';
    await renderReadyPage();
    expect(screen.getByText('load_failed')).toBeInTheDocument();
  });
});

describe('FacesPage compatibility redirect', () => {
  it('redirects former Faces bookmarks into the Library tab', async () => {
    const { container } = render(<FacesPage />);
    await waitFor(() => expect(harness.replace).toHaveBeenCalledWith('/library?tab=faces'));
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
  });
});
