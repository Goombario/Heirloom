/** @vitest-environment happy-dom */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MobileLightbox from '@/app/components/lightbox/MobileLightbox';
import PhotoStage from '@/app/components/lightbox/PhotoStage';
import type { LightboxTag } from '@/app/components/lightbox/types';
import type { Media } from '@/lib/db/schema';

const translations: Record<string, string> = {
  photo_alt: 'Photo', photo_counter: '{current} / {total}', thumbnail_n: 'Photo {n}',
  tag_a_face: 'Tag a face', redraw_face: 'Redraw face', redraw_box_prompt: 'Drag a new box over this face to replace its region.',
  draw_box_prompt: 'Drag a box over the face to tag someone.', tag_mode_esc_hint: 'Press Esc or Done tagging to finish.',
  done: 'Done', details: 'Details', collapse: 'Collapse', people_count: '{count} people',
  show_boxes: 'Show names & boxes', hide_boxes: 'Hide names & boxes', close: 'Close',
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    let value = translations[key] ?? key;
    for (const [name, replacement] of Object.entries(values ?? {})) value = value.replace(`{${name}}`, String(replacement));
    return value;
  },
}));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
// The picker and tag sheet as buttons, so a test can pick someone or ask to move a face.
vi.mock('@/app/components/PersonPickerSheet', () => ({
  PersonPickerSheet: ({ open, onPick }: { open: boolean; onPick: (p: unknown[]) => void }) => open
    ? <button type="button" onClick={() => onPick([{ kind: 'existing', person: { Id: 7, FirstName: 'Bea', LastName: 'Example' } }])}>Pick Bea</button>
    : null,
}));
vi.mock('@/app/components/lightbox/MobilePhotoSheets', () => ({
  TagSheet: ({ open, onRedraw }: { open: boolean; onRedraw: () => void }) => open ? <button type="button" onClick={onRedraw}>Move the face circle</button> : null,
  EditPhotoSheet: () => null,
}));
vi.mock('vaul', () => ({
  Drawer: {
    Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Content: ({ children, ...props }: { children: React.ReactNode }) => <div {...props}>{children}</div>,
    Title: ({ children, ...props }: { children: React.ReactNode }) => <h1 {...props}>{children}</h1>,
  },
}));
vi.mock('embla-carousel-react', () => ({
  default: () => [() => {}, {
    canScrollPrev: () => false, canScrollNext: () => false, selectedScrollSnap: () => 0,
    scrollPrev: vi.fn(), scrollNext: vi.fn(), scrollTo: vi.fn(), reInit: vi.fn(), on: vi.fn(), off: vi.fn(),
  }],
}));
vi.mock('@/app/components/MediaImg', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, ...props }: { alt: string }) => <img alt={alt} src="/stub.jpg" {...props} />,
}));

const tag = {
  Id: 1, MediaId: 10, PersonId: 42, RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20,
  PersonFirstName: 'Ada', PersonLastName: 'Example', PersonEffectiveFirstName: null, PersonNickname: null,
  IsPersonPrimary: false,
} as unknown as LightboxTag;
const items = [{ Id: 10, Title: 'Photo' }] as Media[];

function makeEvidence(onStartRedraw = vi.fn()) {
  return {
    canDelete: true, title: 'Photo', editing: false, formTitle: '', formDate: '', onStartEdit: vi.fn(), onChangeTitle: vi.fn(), onChangeDate: vi.fn(),
    onSaveEdit: vi.fn(), onCancelEdit: vi.fn(), tags: [tag], galleryPersonId: undefined,
    showNames: false, onToggleNames: vi.fn(), onHoverTag: vi.fn(), canRemoveTag: () => true,
    onStartRedraw, onRemoveTag: vi.fn(), onStartTag: vi.fn(), showPrimary: false,
    isPersonPrimary: false, onSetPrimary: vi.fn(), setPrimaryLabel: 'Set as primary',
    downloadHref: '#', onDelete: vi.fn(), busy: false, errorMessage: null,
  };
}

function renderMobile() {
  const phone = { faceIds: [], onNameFace: vi.fn(), onRetag: vi.fn(), onSaveDetails: vi.fn(), portraitLabel: null, onTagFace: vi.fn(), onAdjustFace: vi.fn() };
  const evidence = makeEvidence();
  const photo = <PhotoStage bare items={items} index={0} onChangeIndex={vi.fn()} treeId={1} alt="Photo"
    tags={[tag]} overlayTags tagMode={false} hoveredTagId={null} onHoverTag={vi.fn()}
    onDrawComplete={vi.fn()} counterCurrent={1} counterTotal={1} ctxNoun="" onClose={vi.fn()} onDoneTagging={vi.fn()} />;
  render(<MobileLightbox mediaId={10} treeId={1} alt="Photo" title="Photo" counterCurrent={1} counterTotal={1}
    tags={[tag]} onClose={vi.fn()} evidence={evidence} isPersonPrimary={false} photo={() => photo} phone={phone} />);
  // Open the Details sheet, where Tag a face and the people rows are.
  fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]);
  return { phone, evidence };
}

// Faces on a phone are tagged and moved with the portrait crop's circle, not drawn as a
// box over the photo (the owner's phone review of #1117).
describe('MobileLightbox face tagging', () => {
  it('Tag a face picks the person first, then hands them to the crop', () => {
    const { phone, evidence } = renderMobile();
    fireEvent.click(screen.getByRole('button', { name: 'Tag a face' }));
    expect(evidence.onStartTag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pick Bea' }));
    expect(phone.onTagFace).toHaveBeenCalledWith(expect.objectContaining({ Id: 7 }));
  });

  it('moving a tagged face opens the crop for that tag, not a draw mode', () => {
    const { phone, evidence } = renderMobile();
    fireEvent.click(screen.getByRole('button', { name: /Ada Example/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Move the face circle' }));
    expect(phone.onAdjustFace).toHaveBeenCalledWith(1);
    expect(evidence.onStartRedraw).not.toHaveBeenCalled();
  });
});
