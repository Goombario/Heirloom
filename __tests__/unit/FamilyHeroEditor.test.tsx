/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { FamilyHeroEditor } from '@/app/families/view/FamilyHeroEditor';
import type { Person } from '@/lib/db/schema';

vi.mock('@/app/components/PersonPicker', () => ({
  default: () => <div data-testid="person-picker" />,
}));
vi.mock('@/app/components/LocationField', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('@/app/components/DateInput', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('@/lib/data', () => ({ getDataClient: vi.fn() }));

const p = (o: Partial<Person>): Person => ({ Id: 1, FirstName: 'A', LastName: 'B', Sex: null, BirthDate: null, DeathDate: null, BirthPlace: null, DeathPlace: null, ...o } as Person);

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
}

function renderEditor(overrides: Partial<React.ComponentProps<typeof FamilyHeroEditor>> = {}) {
  return wrap(
    <FamilyHeroEditor
      partner1={p({ Id: 7 })}
      partner2={p({ Id: 8 })}
      type="Marriage"
      marriageDate="1920"
      marriagePlace={null}
      endEvent={null}
      treeId={1}
      saving={false}
      canDelete={true}
      onSave={vi.fn()}
      onCancel={() => {}}
      onDelete={() => {}}
      {...overrides}
    />
  );
}

describe('FamilyHeroEditor', () => {
  it('blocks save when both partners are removed', () => {
    const onSave = vi.fn();
    renderEditor({ partner1: null, partner2: null, onSave });
    fireEvent.click(screen.getByRole('button', { name: en.common.save_changes }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('saves the partners, type, start and no end', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor({ onSave });
    fireEvent.click(screen.getByRole('button', { name: en.common.save_changes }));
    expect(onSave).toHaveBeenCalledWith({
      Partner1Id: 7, Partner2Id: 8, Type: 'Marriage',
      MarriageDate: '1920', MarriagePlace: null, MarriagePlaceId: null, placeResolution: undefined, end: null,
    });
  });

  it('shows the type as a segmented control, not a native select', () => {
    renderEditor();
    expect(screen.getByRole('radiogroup', { name: en.editFamily.type_label })).toBeTruthy();
    expect(document.querySelector('select')).toBeNull();
  });

  it('records a new end with its reason', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderEditor({ onSave });
    fireEvent.click(screen.getByRole('radio', { name: en.editFamily.reason_divorce }));
    fireEvent.click(screen.getByRole('button', { name: en.common.save_changes }));
    expect(onSave.mock.calls[0][0].end).toEqual({ reason: 'Divorce', date: null });
  });

  it('keeps an existing end event: no "not recorded" option, its reason preselected', () => {
    renderEditor({ endEvent: { Type: 'SEPA', Date: '1931' } });
    expect(screen.queryByRole('radio', { name: en.editFamily.ended_unrecorded })).toBeNull();
    expect(screen.getByRole('radio', { name: en.editFamily.reason_separation }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText(en.editFamily.ended_date) as HTMLInputElement).value).toBe('1931');
  });

  it('puts the delete on the quiet danger-text style, never a red fill', () => {
    renderEditor();
    const del = screen.getByRole('button', { name: `${en.editFamily.delete_partnership}…` });
    expect(del.className).toContain('text-error');
    expect(del.className).not.toContain('bg-button-danger');
  });

  it('renders the delete action for a user who may delete', () => {
    const { queryByText } = renderEditor({ canDelete: true });
    expect(queryByText(`${en.editFamily.delete_partnership}…`)).not.toBeNull();
  });

  it('hides the delete action for a contribute-role user (the server would 403)', () => {
    const { queryByText } = renderEditor({ canDelete: false });
    expect(queryByText(`${en.editFamily.delete_partnership}…`)).toBeNull();
  });
});
