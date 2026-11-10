/**
 * @vitest-environment happy-dom
 *
 * Rail behaviours introduced by #457 and #459. The rail previously had a hover
 * background and no click target, and gave a destructive control the same focus
 * ring as benign ones — both are invisible to type checking, so they need a test.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import EvidencePanel from '@/app/components/lightbox/EvidencePanel';
import MobileEvidence from '@/app/components/lightbox/MobileEvidence';
import type { LightboxTag } from '@/app/components/lightbox/types';

const translations: Record<string, string> = {
  photo_alt: 'Photo',
  people_in_photo: 'People in this photo',
  no_one_tagged: 'No one tagged yet',
  tag_a_face: 'Tag a face',
  show_boxes: 'Show names and boxes',
  hide_boxes: 'Hide names and boxes',
  current_profile_picture: 'Current profile picture',
  remove_tag: 'Remove tag',
  cant_untag_primary: 'Cannot untag the profile picture',
  delete: 'Delete',
  download: 'Download',
  edit: 'Edit',
  save: 'Save',
  cancel: 'Cancel',
  redraw_tag: 'Redraw region',
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    let value = translations[key] ?? key;
    for (const [name, replacement] of Object.entries(values ?? {})) {
      value = value.replace(`{${name}}`, String(replacement));
    }
    return value;
  },
}));

function makeTag(overrides: Partial<LightboxTag> = {}): LightboxTag {
  return {
    Id: 1,
    MediaId: 10,
    PersonId: 42,
    RegionX: 10,
    RegionY: 10,
    RegionW: 20,
    RegionH: 20,
    IsPrimary: 0,
    PersonFirstName: 'Ada',
    PersonLastName: 'Example',
    PersonEffectiveFirstName: null,
    PersonNickname: null,
    ...overrides,
  } as LightboxTag;
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof EvidencePanel>> = {}) {
  const onHoverTag = vi.fn();
  const onRemoveTag = vi.fn();
  const onStartRedraw = vi.fn();
  render(
    <EvidencePanel
      title="A photo"
      editing={false}
      formTitle=""
      formDate=""
      onChangeDate={vi.fn()}
      onStartEdit={vi.fn()}
      onChangeTitle={vi.fn()}
      onSaveEdit={vi.fn()}
      onCancelEdit={vi.fn()}
      tags={[makeTag()]}
      canDelete
      onToggleNames={vi.fn()}
      canRemoveTag={() => true}
      onRemoveTag={onRemoveTag}
      onStartRedraw={onStartRedraw}
      onStartTag={vi.fn()}
      showPrimary={false}
      isPersonPrimary={false}
      onSetPrimary={vi.fn()}
      setPrimaryLabel="Set as profile picture"
      downloadHref="/download"
      onDelete={vi.fn()}
      busy={false}
      {...overrides}
      onHoverTag={overrides.onHoverTag ?? onHoverTag}
      showNames={overrides.showNames ?? true}
    />,
  );
  return { onHoverTag, onRemoveTag, onStartRedraw };
}

function renderMobile(overrides: Partial<React.ComponentProps<typeof MobileEvidence>> = {}) {
  const onStartRedraw = vi.fn();
  const onRemoveTag = vi.fn();
  const onOpenTag = vi.fn();
  const onNameFace = vi.fn();
  render(
    <MobileEvidence
      title="A photo"
      editing={false}
      formTitle=""
      formDate=""
      onChangeDate={vi.fn()}
      onStartEdit={vi.fn()}
      onChangeTitle={vi.fn()}
      onSaveEdit={vi.fn()}
      onCancelEdit={vi.fn()}
      tags={[makeTag({ IsPersonPrimary: true })]}
      canDelete
      galleryPersonId={42}
      canRemoveTag={() => true}
      onStartRedraw={onStartRedraw}
      onRemoveTag={onRemoveTag}
      onStartTag={vi.fn()}
      showPrimary
      isPersonPrimary
      onSetPrimary={vi.fn()}
      setPrimaryLabel="Set as profile picture"
      downloadHref="/download"
      onDelete={vi.fn()}
      busy={false}
      faceIds={[]}
      onOpenTag={onOpenTag}
      onNameFace={onNameFace}
      portraitLabel="Ada Example's profile picture"
      {...overrides}
      onHoverTag={overrides.onHoverTag ?? vi.fn()}
      showNames={overrides.showNames ?? true}
      onToggleNames={overrides.onToggleNames ?? vi.fn()}
    />,
  );
  return { onStartRedraw, onRemoveTag, onOpenTag, onNameFace };
}

describe('EvidencePanel rail', () => {
  it('makes a tagged name a link to the person (#457)', () => {
    renderPanel();
    expect(screen.getByRole('link', { name: /Ada Example/ })).toHaveAttribute(
      'href',
      '/people/view?id=42',
    );
  });

  it('keeps remove out of the link, so the row stays valid HTML', () => {
    renderPanel();
    const link = screen.getByRole('link', { name: /Ada Example/ });
    const remove = screen.getByRole('button', { name: 'Remove tag' });
    expect(link.contains(remove)).toBe(false);
  });

  it('exposes a keyboard-reachable redraw action for each tagged face', () => {
    const { onStartRedraw } = renderPanel();
    const redraw = screen.getByRole('button', { name: 'Redraw region' });
    expect(redraw).toHaveAttribute('title', 'Redraw region');
    fireEvent.click(redraw);
    expect(onStartRedraw).toHaveBeenCalledWith(1);
  });

  it('keeps the remove action available for a derived-primary tag', () => {
    const { onRemoveTag } = renderPanel({
      isPersonPrimary: true,
      galleryPersonId: 42,
      canRemoveTag: () => true,
    });
    expect(screen.queryByRole('img', { name: 'Cannot untag the profile picture' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag' }));
    expect(onRemoveTag).toHaveBeenCalledWith(1);
  });

  it('highlights the matching face when the name is focused', () => {
    const { onHoverTag } = renderPanel();
    fireEvent.focus(screen.getByRole('link', { name: /Ada Example/ }));
    expect(onHoverTag).toHaveBeenCalledWith(1);
  });

  it('gives the destructive remove control a destructive focus ring (#459)', () => {
    renderPanel();
    const remove = screen.getByRole('button', { name: 'Remove tag' });
    expect(remove.className).toContain('focus-visible:ring-error');
    expect(remove.className).not.toContain('focus-visible:ring-focus');
  });

  it('does not carry the destructive signal on colour alone', () => {
    // The meaning has to survive with hue removed (red-green colour vision
    // deficiency), which the accessible name provides.
    renderPanel();
    expect(screen.getByRole('button', { name: 'Remove tag' })).toBeInTheDocument();
  });

  it('shows a lock instead of remove when the tag cannot be removed', () => {
    renderPanel({ canRemoveTag: () => false });
    expect(screen.queryByRole('button', { name: 'Remove tag' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cannot untag the profile picture' })).toBeInTheDocument();
  });
});

describe('MobileEvidence Details sheet (#1121)', () => {
  it("opens an editor's person row as the tag sheet", () => {
    const { onOpenTag } = renderMobile();
    fireEvent.click(screen.getByRole('button', { name: /Ada Example/ }));
    expect(onOpenTag).toHaveBeenCalledWith(1);
  });

  it("sends a viewer's person row straight to the person", () => {
    renderMobile({ canEdit: false, canDelete: false });
    expect(screen.getByRole('link', { name: /Ada Example/ })).toHaveAttribute('href', '/people/view?id=42');
    expect(screen.queryByRole('button', { name: 'Tag a face' })).not.toBeInTheDocument();
  });

  it('lists unnamed faces as Who is this? rows', () => {
    const { onNameFace } = renderMobile({ faceIds: [7] });
    fireEvent.click(screen.getByRole('button', { name: 'who_is_this' }));
    expect(onNameFace).toHaveBeenCalledWith(7);
  });

  it('disables the rows while a write is busy', () => {
    renderMobile({ busy: true });
    expect(screen.getByRole('button', { name: /Ada Example/ })).toBeDisabled();
  });

  it('keeps contributor edits but hides Delete', () => {
    renderMobile({ canEdit: true, canDelete: false });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tag a face' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete_photo/ })).not.toBeInTheDocument();
  });

  it('names the photo as their profile picture instead of offering it again', () => {
    renderMobile();
    expect(screen.getByText("Ada Example's profile picture")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set as profile picture/ })).not.toBeInTheDocument();
  });

  it('offers the copper Set as profile picture when it is not yet', () => {
    const onSetPrimary = vi.fn();
    renderMobile({ isPersonPrimary: false, onSetPrimary });
    fireEvent.click(screen.getByRole('button', { name: /Set as profile picture/ }));
    expect(onSetPrimary).toHaveBeenCalledOnce();
  });
});

describe('EvidencePanel permission matrix', () => {
    it('keeps contributor edits but hides destructive controls on desktop', () => {
        renderPanel({ canEdit: true, canDelete: false });
        expect(screen.getByRole('button', { name: 'edit_details' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Redraw region' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Tag a face' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove tag' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });
});

describe('Lightbox header (#894)', () => {
    const long = '2026-09-10_21-02-08-02_a_very_long_camera_filename.jpg';

    it.each([
        ['desktop', () => renderPanel({ title: long })],
    ])('wraps a long title instead of truncating it, and Edit leaves its row (%s)', (_, renderIt) => {
        renderIt();
        const title = screen.getByText(long);
        expect(title.className).not.toContain('truncate');
        expect(title.className).toContain('[overflow-wrap:anywhere]');
        // Edit's row doesn't hold the title, so the title keeps the full width.
        const edit = screen.getByRole('button', { name: 'edit_details' });
        expect(edit.parentElement?.contains(title)).toBe(false);
    });

    it('keeps the date row for Edit when there is no date', () => {
        renderPanel({ date: null });
        expect(screen.getByRole('button', { name: 'edit_details' })).toBeInTheDocument();
    });
});
