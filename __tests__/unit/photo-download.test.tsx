/** @vitest-environment happy-dom */

import React from 'react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import EvidencePanel, { type EvidencePanelProps } from '@/app/components/lightbox/EvidencePanel';
import MobileEvidence from '@/app/components/lightbox/MobileEvidence';

function props(patch: Partial<EvidencePanelProps> = {}): EvidencePanelProps {
  return {
    canEdit: false, canDelete: false, title: 'Anna 1921', date: null, editing: false, formTitle: '', formDate: '',
    onStartEdit: vi.fn(), onChangeTitle: vi.fn(), onChangeDate: vi.fn(), onSaveEdit: vi.fn(), onCancelEdit: vi.fn(),
    tags: [], showNames: false, onToggleNames: vi.fn(), onHoverTag: vi.fn(), canRemoveTag: () => false,
    onStartRedraw: vi.fn(), onRemoveTag: vi.fn(), onStartTag: vi.fn(), showPrimary: false, isPersonPrimary: false,
    onSetPrimary: vi.fn(), setPrimaryLabel: 'Set as profile picture',
    downloadHref: '/api/media/7/file', downloadName: 'anna-1921.jpg',
    onDelete: vi.fn(), busy: false,
    ...patch,
  };
}

const phone = { faceIds: [], onNameFace: vi.fn(), onOpenTag: vi.fn(), portraitLabel: null };
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>);

describe('photo Download (#188)', () => {
  it('hosted: links the file route and names the download', () => {
    wrap(<EvidencePanel {...props()} />);
    const link = screen.getByRole('link', { name: /Download/ });
    expect(link).toHaveAttribute('href', '/api/media/7/file');
    expect(link).toHaveAttribute('download', 'anna-1921.jpg');
  });

  it('local desktop: saves through onDownload instead of following the dead route', () => {
    const onDownload = vi.fn();
    wrap(<EvidencePanel {...props({ onDownload })} />);
    const link = screen.getByRole('link', { name: /Download/ });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(link, click);
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(click.defaultPrevented).toBe(true);
  });

  it('local phone: the Details sheet row does the same', () => {
    const onDownload = vi.fn();
    wrap(<MobileEvidence {...props({ onDownload })} {...phone} />);
    const link = screen.getByRole('link', { name: /Download/ });
    expect(link).toHaveAttribute('download', 'anna-1921.jpg');
    fireEvent.click(link);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});
