/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { EventTypeField } from '@/app/components/events/EventTypeField';

// The desktop event panel's searchable Type field (#162, option B).

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.name != null ? `${key}:${values.name}` : values?.count != null ? `${key}:${values.count}` : key,
}));

const LABELS: Record<string, string> = { BIRT: 'Birth', ADOP: 'Adoption', BAPM: 'Baptism', GRAD: 'Graduation', OCCU: 'Occupation' };
const labelOf = (type: string) => LABELS[type] ?? type;
const groups = [
  { key: 'life', label: 'Life', types: ['BIRT', 'ADOP'] },
  { key: 'faith', label: 'Faith', types: ['BAPM'] },
  { key: 'work', label: 'Work and school', types: ['OCCU', 'GRAD'] },
];
const used = [{ type: 'Military service', count: 4 }, { type: 'Medal of Military Merit', count: 1 }];

function Harness({ onPick }: { onPick: (v: string) => void }) {
  const [value, setValue] = useState('');
  return <EventTypeField value={value} groups={groups} used={used} labelOf={labelOf} onChange={(v) => { setValue(v); onPick(v); }} />;
}

const options = () => screen.getAllByRole('option').map((o) => o.textContent);

describe('EventTypeField (#162)', () => {
  it('opens on Used in this tree with counts, then the standard groups', () => {
    render(<Harness onPick={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(options()).toEqual([
      'Military servicetype_used_count:4', 'Medal of Military Merittype_used_count:1',
      'Birth', 'Adoption', 'Baptism', 'Occupation', 'Graduation',
    ]);
    expect(screen.getByText('group_used')).toBeTruthy();
    expect(screen.getByText('not_listed')).toBeTruthy();
  });

  it('offers a standard type first, and no Add row, when the text names one', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'graduation' } });
    expect(options()).toEqual(['Graduation']);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('GRAD');
  });

  it('matches used labels and ends with Add as a new event type', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Mil' } });
    expect(screen.getByText('type_no_match')).toBeTruthy();
    expect(options()).toEqual([
      'Military servicetype_used_count:4', 'Medal of Military Merittype_used_count:1', 'add_custom:Mil',
    ]);
    fireEvent.click(screen.getByText('add_custom:Mil'));
    expect(onPick).toHaveBeenCalledWith('Mil');
    expect((input as HTMLInputElement).value).toBe('Mil');
  });

  it('picks a used label as written, without offering to add it again', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'military service' } });
    expect(screen.queryByText(/add_custom/)).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('Military service');
  });

  it('closes on Escape without changing the type', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Bapt' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });
});
