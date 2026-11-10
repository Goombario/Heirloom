/** @vitest-environment happy-dom */

import React from 'react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import EvidencePanel, { type EvidencePanelProps } from '@/app/components/lightbox/EvidencePanel';
import MobileEvidence from '@/app/components/lightbox/MobileEvidence';
import type { DocumentRail } from '@/app/components/lightbox/DocumentLinks';
import type { MediaLinkOwner } from '@/lib/db/schema';

const owner = (patch: Partial<MediaLinkOwner>): MediaLinkOwner => ({
  OwnerTable: 'People', OwnerId: 10, OwnerFact: null, PersonId: 10, FirstName: 'Ann', LastName: 'Arbor',
  Partner2FirstName: null, Partner2LastName: null, SourceTitle: null, EventType: null, FactDate: null,
  ...patch,
});

const LINKS: MediaLinkOwner[] = [
  owner({ OwnerFact: 'Birth', FactDate: '1889' }),
  owner({ OwnerTable: 'Sources', OwnerId: 5, PersonId: null, FirstName: null, LastName: null, SourceTitle: 'Parish register' }),
];

function props(document: Partial<DocumentRail> = {}): EvidencePanelProps {
  return {
    canEdit: true, canDelete: true, title: 'Birth register', date: null, editing: false, formTitle: '', formDate: '',
    onStartEdit: vi.fn(), onChangeTitle: vi.fn(), onChangeDate: vi.fn(), onSaveEdit: vi.fn(), onCancelEdit: vi.fn(),
    tags: [], showNames: false, onToggleNames: vi.fn(), onHoverTag: vi.fn(), canRemoveTag: () => true,
    onStartRedraw: vi.fn(), onRemoveTag: vi.fn(), onStartTag: vi.fn(), showPrimary: true, isPersonPrimary: false,
    onSetPrimary: vi.fn(), setPrimaryLabel: 'Set as profile picture', downloadHref: '/api/media/7/file',
    onDelete: vi.fn(), busy: false,
    document: {
      meta: 'PDF · 2 pages · 1.2 MB', links: LINKS, onLink: vi.fn(), onUnlink: vi.fn(),
      fileHref: '/api/media/7/file', downloadHref: '/api/media/7/file?download=1', downloadName: 'birth-register.pdf',
      ...document,
    },
  };
}

const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>);

describe('document rail (#510)', () => {
  it('shows Linked to in place of faces and portraits, with the file actions', () => {
    const p = props();
    wrap(<EvidencePanel {...p} />);

    expect(screen.getByText('PDF · 2 pages · 1.2 MB')).toBeInTheDocument();
    expect(screen.getByText('Linked to')).toBeInTheDocument();
    expect(screen.queryByText('People in this photo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tag a face/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set as profile picture' })).not.toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Ann Arbor/ })).toHaveAttribute('href', '/people/view?id=10');
    expect(screen.getByRole('link', { name: /Ann Arbor/ })).toHaveTextContent('Birth');
    expect(screen.getByRole('link', { name: /Parish register/ })).toHaveAttribute('href', '/library?tab=sources&source=5');

    expect(screen.getByRole('link', { name: 'Open in new tab' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/api/media/7/file?download=1');
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'birth-register.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'Link to a person or source' }));
    expect(p.document!.onLink).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove link to Parish register' }));
    expect(p.document!.onUnlink).toHaveBeenCalledWith(LINKS[1]);
  });

  it('says when a document is linked to nothing, and hides editing from viewers', () => {
    wrap(<EvidencePanel {...props({ links: [] })} canEdit={false} />);
    expect(screen.getByText('Not linked to anyone or any source yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link to a person or source' })).not.toBeInTheDocument();
  });

  it('lists the links, Open PDF, Download and Delete document on the phone', () => {
    wrap(<MobileEvidence {...props()} faceIds={[]} onNameFace={vi.fn()} onOpenTag={vi.fn()} portraitLabel={null} />);
    expect(screen.getByRole('link', { name: /Ann Arbor/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open PDF/ })).toHaveAttribute('href', '/api/media/7/file');
    expect(screen.getByRole('button', { name: 'Delete document' })).toBeInTheDocument();
    expect(screen.queryByText('Tag a face')).not.toBeInTheDocument();
  });
});
