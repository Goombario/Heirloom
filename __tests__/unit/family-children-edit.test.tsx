/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { ChildrenList } from '@/app/families/view/sections';
import type { PartnerPerson } from '@/app/families/view/useFamilyDetail';

vi.mock('@/app/components/PersonPicker', () => ({ default: () => <div data-testid="child-picker" /> }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 1 }) }));

/** One type for both partners, as a child row carries it. */
const rel = (type: string | null) => ({ Partner1Relationship: type, Partner2Relationship: type });
const child = (o: Partial<PartnerPerson>): PartnerPerson => ({ Id: 5, FirstName: 'Kid', LastName: 'One', Sex: null, BirthDate: '1880', DeathDate: null, BirthPlace: null, DeathPlace: null, ...o } as PartnerPerson);

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
}

const editButton = () => screen.getByRole('button', { name: en.common.edit_named.replace('{name}', 'Kid One') });
const relTrigger = () => screen.getByRole('button', { name: new RegExp(en.editFamily.relationship_type) });

describe('ChildrenList', () => {
  it('has no Edit/Done list mode and no native select (#760)', () => {
    wrap(<ChildrenList childList={[child({})]} treeId={1} familyId={1} canEdit canDelete onChanged={() => {}} />);
    expect(screen.queryByRole('button', { name: en.common.done })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(document.querySelector('select')).toBeNull();
  });

  it('says a child died young as text on the life-span line, not as a tag (#808, CL-3)', () => {
    wrap(<ChildrenList childList={[child({ BirthDate: '1917', DeathDate: '1933' })]} treeId={1} familyId={1} canEdit={false} canDelete={false} onChanged={() => {}} />);
    const age = screen.getByText(en.families.died_age.replace('{age}', '16'), { exact: false });
    expect(age.textContent).toBe(` · ${en.families.died_age.replace('{age}', '16')}`);
    expect(age.closest('span.text-xs.font-medium')).toBeNull(); // Badge's tag recipe
    expect(age.parentElement?.textContent).toContain('1917\u2009–\u20091933');
  });

  it('gives each row Edit and Remove actions, named for the child', () => {
    wrap(<ChildrenList childList={[child({})]} treeId={1} familyId={1} canEdit canDelete onChanged={() => {}} />);
    expect(editButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: en.common.remove_named.replace('{name}', 'Kid One') })).toBeTruthy();
  });

  it('gives a contributor Edit and Add child, but no Remove or Move…, which the services refuse them (#848)', () => {
    wrap(<ChildrenList childList={[child({})]} treeId={1} familyId={1} canEdit canDelete={false} onChanged={() => {}} />);
    expect(editButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: en.editFamily.add_child })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.common.remove_named.replace('{name}', 'Kid One') })).toBeNull();
    expect(screen.queryByRole('button', { name: en.families.move_child_named.replace('{name}', 'Kid One') })).toBeNull();
  });

  it('gives owner and edit rungs Remove and Move… (#848)', () => {
    wrap(<ChildrenList childList={[child({})]} treeId={1} familyId={1} canEdit canDelete onChanged={() => {}} />);
    expect(screen.getByRole('button', { name: en.common.remove_named.replace('{name}', 'Kid One') })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.families.move_child_named.replace('{name}', 'Kid One') })).toBeTruthy();
  });

  it('shows no row actions and no Add row without edit permission', () => {
    wrap(<ChildrenList childList={[child({})]} treeId={1} familyId={1} canEdit={false} canDelete={false} onChanged={() => {}} />);
    expect(screen.queryByRole('button', { name: en.common.edit_named.replace('{name}', 'Kid One') })).toBeNull();
    expect(screen.queryByRole('button', { name: en.editFamily.add_child })).toBeNull();
  });

  it('ends the list with an Add child row that opens the picker panel after the last child', () => {
    const { container } = wrap(<ChildrenList childList={[child({ Id: 5 }), child({ Id: 6 })]} treeId={1} familyId={1} canEdit canDelete onChanged={() => {}} />);
    expect(container.querySelector('[data-testid="add-child-picker"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.editFamily.add_child }));
    const picker = container.querySelector('[data-testid="add-child-picker"]');
    const rows = container.querySelectorAll('a[href^="/people/view"]');
    expect(picker).not.toBeNull();
    expect(rows[rows.length - 1].compareDocumentPosition(picker!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the relationship editor on the child’s stored type', () => {
    wrap(<ChildrenList childList={[child({ ...rel('Adoption') })]} treeId={1} familyId={1} canEdit canDelete onChanged={() => {}} />);
    fireEvent.click(editButton());
    expect(relTrigger().textContent).toContain(en.editFamily.rel_adoption);
  });

  it('leaves a legacy NULL relationship type unrecorded rather than claiming Birth', () => {
    wrap(<ChildrenList childList={[child({ ...rel(null) })]} treeId={1} familyId={1} canEdit canDelete onChanged={() => {}} />);
    fireEvent.click(editButton());
    expect(relTrigger().textContent).toContain(en.editFamily.rel_unrecorded);
    expect((screen.getByRole('button', { name: en.common.save_changes }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows "Not recorded" rather than "Birth" for a stored type the editor does not offer', () => {
    // The columns are unchecked TEXT, so a row can hold a value outside the set.
    // It must render as unrecorded, not be silently reported as Birth.
    const legacy = child(rel('Sealed'));
    wrap(<ChildrenList childList={[legacy]} treeId={1} familyId={1} canEdit canDelete onChanged={() => {}} />);
    fireEvent.click(editButton());
    expect(relTrigger().textContent).toContain(en.editFamily.rel_unrecorded);
  });

  // #484: the child link type is data the read view held but never showed.
  it('labels a non-birth child with its relationship type in the read view', () => {
    wrap(<ChildrenList childList={[child({ Id: 5, ...rel('Adoption') })]} treeId={1} familyId={1} canEdit={false} canDelete={false} onChanged={() => {}} />);
    expect(screen.getByText(en.editFamily.rel_adoption)).toBeTruthy();
  });

  it('labels a foster child too', () => {
    wrap(<ChildrenList childList={[child({ Id: 5, ...rel('Foster') })]} treeId={1} familyId={1} canEdit={false} canDelete={false} onChanged={() => {}} />);
    expect(screen.getByText(en.editFamily.rel_foster)).toBeTruthy();
  });

  // Birth is the default; tagging every row would add noise, not information.
  it('leaves a birth child unlabelled', () => {
    wrap(<ChildrenList childList={[child({ Id: 5, ...rel('Birth') })]} treeId={1} familyId={1} canEdit={false} canDelete={false} onChanged={() => {}} />);
    expect(screen.queryByText(en.editFamily.rel_birth)).toBeNull();
  });

  // Same reasoning as the editor's placeholder: an unrecorded or retired value
  // must not be rendered as a type we do not actually hold.
  it('leaves an unrecorded or out-of-vocabulary type unlabelled', () => {
    const { container: a } = wrap(<ChildrenList childList={[child({ Id: 5, ...rel(null) })]} treeId={1} familyId={1} canEdit={false} canDelete={false} onChanged={() => {}} />);
    expect(a.textContent).not.toContain(en.editFamily.rel_unrecorded);
    const legacy = child({ Id: 6, ...rel('Sealed') });
    const { container: b } = wrap(<ChildrenList childList={[legacy]} treeId={1} familyId={1} canEdit={false} canDelete={false} onChanged={() => {}} />);
    expect(b.textContent).not.toContain('Sealed');
  });

  describe('one relationship per partner (#982)', () => {
    const tom = { Id: 1, FirstName: 'Tom', LastName: 'Doe', Sex: 'M' } as PartnerPerson;
    const ann = { Id: 2, FirstName: 'Ann', LastName: 'Roe', Sex: 'F' } as PartnerPerson;
    const stepOfAnn = child({ Id: 5, Partner1Relationship: 'Birth', Partner2Relationship: 'Step' });

    it('names the partner a child is a stepchild of', () => {
      wrap(<ChildrenList childList={[stepOfAnn]} partner1={tom} partner2={ann} treeId={1} familyId={1} canEdit={false} canDelete={false} onChanged={() => {}} />);
      expect(screen.getByText(en.editFamily.rel_of_step.replace('{name}', 'Ann'))).toBeTruthy();
    });

    it('shows one word when both partners share a type', () => {
      wrap(<ChildrenList childList={[child({ Id: 5, ...rel('Adoption') })]} partner1={tom} partner2={ann} treeId={1} familyId={1} canEdit={false} canDelete={false} onChanged={() => {}} />);
      expect(screen.getByText(en.editFamily.rel_adoption)).toBeTruthy();
    });

    it('edits each partner with its own select', () => {
      wrap(<ChildrenList childList={[stepOfAnn]} partner1={tom} partner2={ann} treeId={1} familyId={1} canEdit canDelete onChanged={() => {}} />);
      fireEvent.click(editButton());
      const to = (name: string) => screen.getByRole('button', { name: new RegExp(en.editFamily.relationship_to.replace('{name}', name)) });
      expect(to('Tom').textContent).toContain(en.editFamily.rel_birth);
      expect(to('Ann').textContent).toContain(en.editFamily.rel_step);
    });
  });
});
