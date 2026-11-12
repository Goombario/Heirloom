/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const state = vi.hoisted(() => ({
  previewGedcom: vi.fn(),
  importGedcom: vi.fn(),
  getCounts: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, { rich: (key: string) => key }),
  useFormatter: () => ({ dateTime: (value: number) => String(value) }),
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 9, activePermission: 'owner' }) }));
vi.mock('@/lib/data', () => ({ DATA_MODE: 'http', getDataClient: vi.fn(async () => ({ gedcom: state, tree: state })) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/hooks/useActiveTreeName', () => ({ useActiveTreeName: () => 'Test tree' }));
vi.mock('@/app/import-export/MediaImportRecovery', () => ({ default: () => <div /> }));
// openGedcomZip reads the .ged through JSZip's internalStream (a capped inflate).
function fakeEntryStream(bytes: Uint8Array) {
  const handlers: Record<string, (arg?: unknown) => void> = {};
  const stream = {
    on(event: string, handler: (arg?: unknown) => void) { handlers[event] = handler; return stream; },
    pause() { return stream; },
    resume() { queueMicrotask(() => { handlers.data?.(bytes); handlers.end?.(); }); return stream; },
  };
  return stream;
}

vi.mock('jszip', () => ({
  default: { loadAsync: vi.fn(async () => ({ files: {
    'family_tree.ged': {
      name: 'family_tree.ged',
      dir: false,
      async: vi.fn(async () => '0 HEAD\n0 TRLR'),
      internalStream: () => fakeEntryStream(new TextEncoder().encode('0 HEAD\n0 TRLR')),
    },
  } })) },
}));

import ImportExportPage from '@/app/import-export/page';

beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  window.history.replaceState(null, '', '/import-export?job=restore');
  state.getCounts.mockResolvedValue({ people: 0, families: 0, children: 0, events: 0, media: 0, sources: 0, citations: 0 });
  state.previewGedcom.mockResolvedValue({ mode: 'overwrite', skipped: [], toImport: { peopleCount: 0, familiesCount: 0, childrenCount: 0, mediaCount: 0, sourcesCount: 0, citationsCount: 0 } });
});

describe('ZIP overwrite safety preview', () => {
  it('does not import when the final safety preview fails', async () => {
    render(<ImportExportPage />);
    await act(async () => {});
    const input = document.querySelector('input[type="file"][accept=".ged,.zip"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['zip'], 'archive.zip', { type: 'application/zip' })] } });
    // Restore a backup always overwrites; the job page sets the mode.
    fireEvent.click(screen.getByRole('button', { name: 'check_file' }));
    await screen.findByRole('button', { name: 'replace_tree' });
    state.previewGedcom.mockRejectedValueOnce(new Error('preview unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'replace_tree' }));
    await waitFor(() => expect(state.previewGedcom).toHaveBeenCalledTimes(2));
    await screen.findByText('error_generic');
    expect(state.importGedcom).not.toHaveBeenCalled();
  });
});
