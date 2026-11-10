import { describe, it, expect } from 'vitest';
import { isVitalPersonType, vitalPatchFor, vitalDeletePatchFor } from '@/app/components/person-form/vitalEvent';

describe('vital event routing', () => {
  it('routes BIRT/DEAT on a person target to the column path', () => {
    expect(isVitalPersonType({ kind: 'person', personId: 1 }, 'BIRT')).toBe(true);
    expect(isVitalPersonType({ kind: 'person', personId: 1 }, 'DEAT')).toBe(true);
    expect(isVitalPersonType({ kind: 'person', personId: 1 }, 'BAPM')).toBe(false);
    expect(isVitalPersonType({ kind: 'family', familyId: 1 }, 'BIRT')).toBe(false);
  });
  it('builds a death patch that flips IsDeceased', () => {
    expect(vitalPatchFor('DEAT', '1970-11-02', 'Portland, ME'))
      .toEqual({ DeathDate: '1970-11-02', DeathPlace: 'Portland, ME', IsDeceased: 1 });
    expect(vitalPatchFor('BIRT', '1901-03-14', 'Boston, MA'))
      .toEqual({ BirthDate: '1901-03-14', BirthPlace: 'Boston, MA' });
  });
  it('normalizes empty/whitespace date and place to null (no empty-string write to columns)', () => {
    expect(vitalPatchFor('BIRT', '', '')).toEqual({ BirthDate: null, BirthPlace: null });
    expect(vitalPatchFor('BIRT', '   ', '  ')).toEqual({ BirthDate: null, BirthPlace: null });
    expect(vitalPatchFor('DEAT', '', ''))
      .toEqual({ DeathDate: null, DeathPlace: null, IsDeceased: 1 });
  });
});

describe('death cause (#480)', () => {
  it('writes DeathCause on a death patch', () => {
    expect(vitalPatchFor('DEAT', '1984-06-02', 'Montréal', 'Heart failure'))
      .toEqual({
        DeathDate: '1984-06-02',
        DeathPlace: 'Montréal',
        DeathCause: 'Heart failure',
        IsDeceased: 1,
      });
  });

  it('normalizes an empty or whitespace-only cause to null', () => {
    expect(vitalPatchFor('DEAT', '1984', '', '')).toEqual({
      DeathDate: '1984', DeathPlace: null, DeathCause: null, IsDeceased: 1,
    });
    expect(vitalPatchFor('DEAT', '1984', '', '   ')).toEqual({
      DeathDate: '1984', DeathPlace: null, DeathCause: null, IsDeceased: 1,
    });
  });

  // "no cause argument" and "clear the cause" must not collapse into the same
  // patch: an editor that never rendered the Cause input passes nothing, and
  // writing null there would destroy a cause entered on the person form.
  it('omits the DeathCause key entirely when the caller passes none', () => {
    const patch = vitalPatchFor('DEAT', '1984', '');
    expect(patch).toEqual({ DeathDate: '1984', DeathPlace: null, IsDeceased: 1 });
    expect('DeathCause' in patch).toBe(false);
  });

  it('still clears the cause when the caller passes an explicit empty string', () => {
    const patch = vitalPatchFor('DEAT', '1984', '', '');
    expect('DeathCause' in patch).toBe(true);
    expect(patch).toEqual({
      DeathDate: '1984', DeathPlace: null, DeathCause: null, IsDeceased: 1,
    });
  });

  it('never puts DeathCause on a birth patch', () => {
    expect(vitalPatchFor('BIRT', '1901', 'Boston', 'ignored'))
      .toEqual({ BirthDate: '1901', BirthPlace: 'Boston' });
  });

  // A cause left behind by a delete is not untidiness: generator.ts emits a
  // "1 DEAT" block when DeathCause is set, so the next export would resurrect
  // the death record the user just removed.
  it('clears every death column on a death delete', () => {
    expect(vitalDeletePatchFor('DEAT')).toEqual({
      DeathDate: null, DeathPlace: null, DeathCause: null, IsDeceased: null,
    });
  });

  it('clears every birth column on a birth delete', () => {
    expect(vitalDeletePatchFor('BIRT')).toEqual({ BirthDate: null, BirthPlace: null });
  });
});
