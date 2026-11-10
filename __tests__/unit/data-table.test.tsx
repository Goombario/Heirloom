/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// Mock next-intl — not testing translations here (DataTable only uses it for
// the select-all / select-row checkbox aria-labels).
const translations: Record<string, string> = {
  select_all: 'Select all',
  select_row: 'Select row',
};
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => translations[key] ?? key,
}));

import { DataTable, type Column } from '@/app/components/ui/DataTable';

interface Row {
  id: number;
  name: string;
  age: number;
}

const rows: Row[] = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Grace', age: 45 },
];

const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, render: (r) => <span>{r.name}</span> },
  { key: 'age', header: 'Age', sortable: true, align: 'right', render: (r) => <span>{r.age}</span> },
  { key: 'actions', header: 'Actions', render: () => <button>View</button> },
];

describe('DataTable', () => {
  it('renders one header cell per column', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Age/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Actions/ })).toBeInTheDocument();
  });

  it('renders a row per data item with rendered cells', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Grace')).toBeInTheDocument();
    // 2 data rows + 1 header row
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('shows a neutral indicator on inactive sortable columns', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} sort={{ key: 'name', dir: 'asc' }} />);
    const ageHeader = screen.getByRole('columnheader', { name: /Age/ });
    expect(ageHeader).toHaveTextContent('↕');
  });

  it('shows the direction arrow on the active sort column', () => {
    const { rerender } = render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} sort={{ key: 'name', dir: 'asc' }} />,
    );
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveTextContent('↑');
    rerender(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} sort={{ key: 'name', dir: 'desc' }} />);
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveTextContent('↓');
  });

  it('calls onSortChange with the column key when a sortable header is clicked', () => {
    const onSortChange = vi.fn();
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onSortChange={onSortChange} />);
    fireEvent.click(screen.getByRole('columnheader', { name: /Name/ }));
    expect(onSortChange).toHaveBeenCalledWith('name');
  });

  it('sorts from the keyboard on Enter and Space', () => {
    const onSortChange = vi.fn();
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onSortChange={onSortChange} />);
    const nameHeader = screen.getByRole('columnheader', { name: /Name/ });
    expect(nameHeader).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(nameHeader, { key: 'Enter' });
    fireEvent.keyDown(nameHeader, { key: ' ' });
    expect(onSortChange).toHaveBeenNthCalledWith(1, 'name');
    expect(onSortChange).toHaveBeenNthCalledWith(2, 'name');
  });

  it('does not call onSortChange for a non-sortable header', () => {
    const onSortChange = vi.fn();
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onSortChange={onSortChange} />);
    fireEvent.click(screen.getByRole('columnheader', { name: /Actions/ }));
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it('renders a selection column with header + per-row checkboxes', () => {
    const onToggle = vi.fn();
    const onToggleAll = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={{ selected: new Set([1]), onToggle, allSelected: false, onToggleAll }}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    // 1 header + 2 rows
    expect(checkboxes).toHaveLength(3);
    // header reflects allSelected=false
    expect(checkboxes[0]).not.toBeChecked();
    // first row is selected
    expect(checkboxes[1]).toBeChecked();
    fireEvent.click(checkboxes[2]);
    expect(onToggle).toHaveBeenCalledWith(2);
    fireEvent.click(checkboxes[0]);
    expect(onToggleAll).toHaveBeenCalled();
  });

  it('does not present a selection checkbox for an ineligible row', () => {
    const onToggle = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selection={{
          selected: new Set(),
          onToggle,
          allSelected: false,
          onToggleAll: vi.fn(),
          isRowSelectable: (row) => row.id !== 2,
        }}
      />,
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(within(screen.getByText('Grace').closest('tr')!).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('renders the empty slot when there are no rows', () => {
    render(
      <DataTable columns={columns} rows={[]} rowKey={(r) => r.id} empty={<div>Nothing here</div>} />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('applies rowClassName', () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowClassName={(r) => (r.id === 1 ? 'first-row' : undefined)}
      />,
    );
    const firstDataRow = screen.getByText('Ada').closest('tr')!;
    expect(within(firstDataRow).getByText('Ada')).toBeInTheDocument();
    expect(firstDataRow).toHaveClass('first-row');
  });
});
