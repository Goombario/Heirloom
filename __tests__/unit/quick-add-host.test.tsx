/** @vitest-environment happy-dom */

import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { lazy, Suspense, type ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuickAddHost, { openQuickAdd } from '@/app/components/QuickAddHost';

let pathname = '/';
let permission: string | null = 'owner';
let phone = false;
const push = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push }),
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 3, activePermission: permission }) }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => phone }));
// next/dynamic as a plain lazy component, so the real loader runs against the mocks below.
vi.mock('next/dynamic', () => ({
  default: (load: () => Promise<ComponentType<Record<string, unknown>>>) => {
    const Lazy = lazy(async () => ({ default: await load() }));
    return (props: Record<string, unknown>) => <Suspense fallback={null}><Lazy {...props} /></Suspense>;
  },
}));
const form = (name: string) => {
  function Form({ open, onCreated }: { open: boolean; onCreated?: (id: number) => void }) {
    return open ? <div role="dialog" aria-label={name}>{onCreated && <button type="button" onClick={() => onCreated(42)}>Save</button>}</div> : null;
  }
  return Form;
};
vi.mock('@/app/people/AddPersonDialog', () => ({ AddPersonDialog: form('New person') }));
vi.mock('@/app/people/AddPersonSheet', () => ({ AddPersonSheet: form('New person sheet') }));
vi.mock('@/app/families/NewFamilyDialog', () => ({ NewFamilyDialog: form('New family') }));
vi.mock('@/app/families/new/mobile/NewFamilySheet', () => ({ NewFamilySheet: form('New family sheet'), afterSheetStep: (go: () => void) => go() }));

beforeEach(() => {
  pathname = '/';
  permission = 'owner';
  phone = false;
  push.mockClear();
});

describe('QuickAddHost', () => {
  it('opens New person over the current page', async () => {
    render(<QuickAddHost />);
    act(() => openQuickAdd('person'));
    expect(await screen.findByRole('dialog', { name: 'New person' })).toBeInTheDocument();
  });

  it('opens the phone sheet on a phone', async () => {
    phone = true;
    render(<QuickAddHost />);
    act(() => openQuickAdd('person'));
    expect(await screen.findByRole('dialog', { name: 'New person sheet' })).toBeInTheDocument();
  });

  it('opens the new family once New family saves', async () => {
    render(<QuickAddHost />);
    act(() => openQuickAdd('family'));
    // The form loads lazily, so wait for it before saving.
    (await screen.findByRole('button', { name: 'Save' })).click();
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/families/view?id=42'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the page changes under it (Save and open)', async () => {
    const view = render(<QuickAddHost />);
    act(() => openQuickAdd('person'));
    await screen.findByRole('dialog', { name: 'New person' });
    pathname = '/people/view';
    view.rerender(<QuickAddHost />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders nothing for a viewer', () => {
    permission = 'view';
    render(<QuickAddHost />);
    act(() => openQuickAdd('person'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
