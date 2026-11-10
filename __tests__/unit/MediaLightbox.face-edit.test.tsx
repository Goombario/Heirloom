/** @vitest-environment happy-dom */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import MediaLightbox from '@/app/components/lightbox/MediaLightbox';
import type { LightboxTag } from '@/app/components/lightbox/types';
import type { Media } from '@/lib/db/schema';
import type { DataClient } from '@/lib/data';

const mobileMode = { value: false };

const translations: Record<string, string> = {
  photo_alt: 'Photo', photo_counter: '{current} / {total}', thumbnail_n: 'Photo {n}',
  tag_a_face: 'Tag a face', redraw_face: 'Redraw face', redraw_tag: 'Redraw region',
  redraw_box_prompt: 'Drag a new box over this face to replace its region.',
  draw_box_prompt: 'Drag a box over the face to tag someone.', tag_mode_esc_hint: 'Press Esc or Done tagging to finish.',
  done_tagging: 'Done tagging', back_to_library: 'Back to library', back_to_gallery: 'Back to gallery',
  close: 'Close', previous: 'Previous', next: 'Next', details: 'Details', collapse: 'Collapse',
  people_in_photo: 'People in this photo', no_one_tagged: 'No one tagged yet', show_boxes: 'Show names & boxes',
  hide_boxes: 'Hide names & boxes', current_profile_picture: 'Current profile picture',
  remove_tag: 'Remove tag',
  set_primary: 'Set as primary', edit_details: 'Edit details', title_label: 'Title', title_placeholder: 'Describe this photo',
  save: 'Save', delete_photo: 'Delete this photo?', delete_body: '{title} will be removed, along with its {count} face tags.',
  delete_primary_warning_generic: 'This is a profile picture.', remove_from_context_body: 'This removes the photo from here.',
  remove_primary_tag_title: 'Remove this face tag?', remove_primary_tag_body: 'Remove this face tag from the photo?',
  remove_primary_tag_warning: "The person's profile crop or photo may change after this face is removed.",
  tag_update_failed: "Couldn't update this face region. Try again.", tag_remove_failed: "Couldn't remove this face tag. Try again.",
  cancel: 'Cancel', remove: 'Remove', delete: 'Delete', download: 'Download', edit: 'Edit',
};

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    let value = translations[key] ?? key;
    for (const [name, replacement] of Object.entries(values ?? {})) value = value.replace(`{${name}}`, String(replacement));
    return value;
  },
}));

vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => mobileMode.value }));
vi.mock('@/app/hooks/useFocusTrap', () => ({ useFocusTrap: () => ({ current: null }) }));
vi.mock('@/app/components/lightbox/WhoIsThisModal', () => ({ default: () => null }));
vi.mock('@/app/components/ui/Sheet', () => ({ Sheet: () => null, ConfirmSheet: () => null }));
vi.mock('@/app/components/PersonPickerSheet', () => ({ PersonPickerSheet: () => null }));
vi.mock('@/app/components/lightbox/MobilePhotoSheets', () => ({
  EditPhotoSheet: () => null,
  TagSheet: ({ open, onRedraw }: { open: boolean; onRedraw: () => void }) => (open ? <button type="button" onClick={onRedraw}>Redraw the face box</button> : null),
}));
vi.mock('vaul', () => ({
  Drawer: {
    Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Content: ({ children, ...props }: { children: React.ReactNode }) => <div {...props}>{children}</div>,
    Title: ({ children, ...props }: { children: React.ReactNode }) => <h1 {...props}>{children}</h1>,
  },
}));
vi.mock('@/app/components/MediaImg', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, ...props }: { alt: string }) => <img alt={alt} src="/stub.jpg" {...props} />,
}));
vi.mock('embla-carousel-react', () => ({
  default: () => [() => {}, {
    canScrollPrev: () => false, canScrollNext: () => false, selectedScrollSnap: () => 0,
    scrollPrev: vi.fn(), scrollNext: vi.fn(), scrollTo: vi.fn(), reInit: vi.fn(), on: vi.fn(), off: vi.fn(),
  }],
}));
vi.mock('@/lib/data', () => ({ getDataClient: vi.fn() }));
const cropProps = vi.fn();
vi.mock('@/app/people/view/mobile/PortraitSheets', () => ({
  CropScreen: (props: Record<string, unknown>) => { cropProps(props); return null; },
}));

const media = { Id: 10, Title: 'A photo' } as unknown as Media;
function makeTag(overrides: Partial<LightboxTag> = {}): LightboxTag {
  return {
    Id: 1, MediaId: 10, PersonId: 42, RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20,
    PersonFirstName: 'Ada', PersonLastName: 'Example', PersonEffectiveFirstName: null, PersonNickname: null,
    IsPersonPrimary: false, ...overrides,
  } as LightboxTag;
}

describe('MediaLightbox face editing', () => {
  beforeEach(async () => {
    mobileMode.value = false;
    const data = await import('@/lib/data');
    vi.mocked(data.getDataClient).mockReset();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    HTMLElement.prototype.setPointerCapture = vi.fn();
  });

  it('redraws an existing region through updateTag without opening the person picker', async () => {
    const data = await import('@/lib/data');
    const tag = makeTag();
    const client = { media: {
      listTags: vi.fn().mockResolvedValue([tag]), updateTag: vi.fn().mockResolvedValue(tag),
      removeTag: vi.fn().mockResolvedValue(undefined),
    } };
    vi.mocked(data.getDataClient).mockResolvedValue(client as unknown as DataClient);
    render(<MediaLightbox items={[media]} index={0} treeId={1} canEdit canDelete onClose={vi.fn()} onChangeIndex={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Redraw region' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Redraw region' }));
    expect(screen.getByRole('status')).toHaveTextContent('Redraw face');
    const drawTarget = document.querySelector('.relative.inline-block') as HTMLElement;
    Object.defineProperties(drawTarget, { offsetWidth: { value: 200 }, offsetHeight: { value: 100 } });
    vi.spyOn(drawTarget, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(drawTarget, { clientX: 20, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(drawTarget, { clientX: 100, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(drawTarget, { pointerId: 1 });

    await waitFor(() => expect(client.media.updateTag).toHaveBeenCalledWith(10, 1, {
      RegionX: 10, RegionY: 10, RegionW: 40, RegionH: 50,
    }, 1));
    expect(screen.queryByText('Who is this?')).not.toBeInTheDocument();
  });

  it('confirms removal of a derived-primary tag and leaves cancel side-effect free', async () => {
    const data = await import('@/lib/data');
    const tag = makeTag({ IsPersonPrimary: true });
    const client = { media: {
      listTags: vi.fn().mockResolvedValue([tag]), updateTag: vi.fn(), removeTag: vi.fn().mockResolvedValue(undefined),
    } };
    vi.mocked(data.getDataClient).mockResolvedValue(client as unknown as DataClient);
    render(<MediaLightbox items={[media]} index={0} treeId={1} context="person" galleryPersonId={42} canEdit canDelete onClose={vi.fn()} onChangeIndex={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove tag' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag' }));
    const confirmDialog = screen.getAllByRole('dialog').at(-1)!;
    expect(confirmDialog).toHaveTextContent('profile crop or photo may change');
    expect(confirmDialog).not.toHaveTextContent(/photo will be deleted|initials|different photo/i);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(client.media.removeTag).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove tag' }));
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removeButtons[removeButtons.length - 1]);
    await waitFor(() => expect(client.media.removeTag).toHaveBeenCalledWith(10, 1, 1));
  });

  it('moves a face on a phone with the portrait crop, opened on that tag', async () => {
    mobileMode.value = true;
    const data = await import('@/lib/data');
    const tag = makeTag();
    const client = { media: { listTags: vi.fn().mockResolvedValue([tag]), updateTag: vi.fn(), createTag: vi.fn(), removeTag: vi.fn() } };
    vi.mocked(data.getDataClient).mockResolvedValue(client as unknown as DataClient);
    render(<MediaLightbox items={[media]} index={0} treeId={1} canEdit canDelete onClose={vi.fn()} onChangeIndex={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Details' })).not.toHaveLength(0));
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]);
    // An editor's person row opens the tag sheet; moving the face opens the crop (phone review of #1117).
    fireEvent.click(await screen.findByRole('button', { name: /Ada/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Redraw the face box' }));
    expect(cropProps).toHaveBeenLastCalledWith(expect.objectContaining({
      purpose: 'tag',
      person: { Id: 42, FirstName: 'Ada', LastName: 'Example' },
      target: { media: expect.objectContaining({ Id: 10, TagRegionX: 10, TagRegionY: 10, TagRegionW: 20, TagRegionH: 20 }) },
    }));
    // No draw mode on a phone any more.
    expect(screen.queryByText('Redraw face')).not.toBeInTheDocument();
  });

  it('hides metadata and face mutation controls in the real read-only lightbox path', async () => {
    const data = await import('@/lib/data');
    const tag = makeTag();
    const client = { media: {
      listTags: vi.fn().mockResolvedValue([tag]), updateTag: vi.fn(),
      removeTag: vi.fn(), createTag: vi.fn(), update: vi.fn(), remove: vi.fn(),
    } };
    vi.mocked(data.getDataClient).mockResolvedValue(client as unknown as DataClient);
    render(<MediaLightbox items={[media]} index={0} treeId={1} canEdit={false} canDelete={false} onClose={vi.fn()} onChangeIndex={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('A photo')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tag a face' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redraw tag' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove tag' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(client.media.update).not.toHaveBeenCalled();
    expect(client.media.updateTag).not.toHaveBeenCalled();
    expect(client.media.removeTag).not.toHaveBeenCalled();
  });

  it('keeps contributor tagging but hides tag removal and hard-delete', async () => {
    const data = await import('@/lib/data');
    const tag = makeTag();
    const client = { media: {
      listTags: vi.fn().mockResolvedValue([tag]), updateTag: vi.fn(),
      removeTag: vi.fn(), createTag: vi.fn(), update: vi.fn(), remove: vi.fn(),
    } };
    vi.mocked(data.getDataClient).mockResolvedValue(client as unknown as DataClient);
    render(<MediaLightbox items={[media]} index={0} treeId={1} canEdit canDelete={false} onClose={vi.fn()} onChangeIndex={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Redraw region' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Tag a face' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove tag' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('keeps contributor context unlinking available without enabling tag removal', async () => {
    const data = await import('@/lib/data');
    const tag = makeTag();
    const unlink = vi.fn().mockResolvedValue(undefined);
    const client = { media: { listTags: vi.fn().mockResolvedValue([tag]) } };
    vi.mocked(data.getDataClient).mockResolvedValue(client as unknown as DataClient);
    render(<MediaLightbox items={[media]} index={0} treeId={1} canEdit canDelete={false} canRemoveFromContext onRemoveFromContext={unlink} removeActionLabel="Remove from case" onClose={vi.fn()} onChangeIndex={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove from case' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Remove tag' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from case' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove from case' }).at(-1)!);
    await waitFor(() => expect(unlink).toHaveBeenCalledWith(10));
  });
});
