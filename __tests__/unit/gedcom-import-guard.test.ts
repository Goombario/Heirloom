import { describe, it, expect } from 'vitest';
import { importGedcomService } from '@/lib/services/gedcom';

// The overwrite zero-record guard (GED-1) throws BEFORE opening a DB connection,
// so it is verifiable without a database.
describe('importGedcomService overwrite safety guard', () => {
  function gedFile(text: string): File {
    return new File([text], 'family_tree.ged', { type: 'text/plain' });
  }

  it('refuses an overwrite that parses to zero records (never wipes the tree)', async () => {
    await expect(
      importGedcomService({ file: gedFile('0 HEAD\n0 TRLR'), mode: 'overwrite', currentUserId: 1 })
    ).rejects.toThrow(/no importable records/i);
  });

  it('also refuses when the body is unparseable junk in overwrite mode', async () => {
    await expect(
      importGedcomService({ file: gedFile('this is not gedcom at all'), mode: 'overwrite', currentUserId: 1 })
    ).rejects.toThrow(/no importable records/i);
  });
});
