/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const state = vi.hoisted(() => ({
  previewGedcom: vi.fn(),
  importGedcom: vi.fn(),
  getCounts: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, { rich: (key: string) => key }),
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 9 }) }));
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
  state.getCounts.mockResolvedValue({ people: 0, families: 0, children: 0, events: 0, media: 0, sources: 0, citations: 0 });
  state.previewGedcom.mockResolvedValue({ mode: 'overwrite', skipped: [], toImport: { peopleCount: 0, familiesCount: 0, childrenCount: 0, mediaCount: 0, sourcesCount: 0, citationsCount: 0 } });
});

describe('ZIP overwrite safety preview', () => {
  it('does not import when the final safety preview fails', async () => {
    render(<ImportExportPage />);
    const input = document.querySelector('input[type="file"][accept=".ged,.zip"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['zip'], 'archive.zip', { type: 'application/zip' })] } });
    // No import mode is pre-selected (FL-1); Preview stays disabled until one is chosen.
    fireEvent.click(document.querySelector('input[type="radio"][value="overwrite"]') as HTMLInputElement);
    // The key-echo mock gives the GEDCOM and spreadsheet preview buttons one name; GEDCOM comes first.
    fireEvent.click(screen.getAllByRole('button', { name: 'preview_button' })[0]);
    await screen.findByRole('button', { name: 'import_button' });
    state.previewGedcom.mockRejectedValueOnce(new Error('preview unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'import_button' }));
    await waitFor(() => expect(state.previewGedcom).toHaveBeenCalledTimes(2));
    await screen.findByText('error_generic');
    expect(state.importGedcom).not.toHaveBeenCalled();
  });
});
