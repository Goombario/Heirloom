import { describe, expect, it, vi } from 'vitest';
import { formatGedcomImportWarning } from '@/lib/gedcom/import-warning';

describe('GEDCOM import warning renderer contract', () => {
  it('translates the structured sidecar warning with its exact interpolation values', () => {
    const translate = vi.fn(() => 'translated warning');

    const result = formatGedcomImportWarning({
      code: 'sidecar_version_newer',
      values: { sidecarName: 'sources.json', declared: 2, supported: 1 },
    }, translate);

    expect(result).toBe('translated warning');
    expect(translate).toHaveBeenCalledWith('warning_sidecar_newer_version', {
      sidecarName: 'sources.json',
      declared: 2,
      supported: 1,
    });
  });

  it('translates the merge xref mismatch warning with its count (#871)', () => {
    const translate = vi.fn(() => 'translated warning');
    formatGedcomImportWarning({ code: 'merge_xref_name_mismatch', values: { count: 2 } }, translate);
    expect(translate).toHaveBeenCalledWith('warning_merge_xref_name_mismatch', { count: 2 });
  });
});
