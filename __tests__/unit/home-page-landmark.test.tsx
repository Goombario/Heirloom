/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/app/hooks/useTimestamp', () => ({
  useTimestamp: () => ({ timestamp: (v: string) => String(v), activityTime: (v: string) => String(v) }),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/app/contexts/TreeContext', () => ({
  useTree: () => ({ activeTreeId: null, activePermission: 'view', currentUserId: 1 }),
}));
vi.mock('@/app/components/useCachedResource', () => ({
  useCachedResource: () => ({ data: null, loading: false }),
}));
vi.mock('@/app/components/useLoadPhase', () => ({ useLoadPhase: () => 'ready' }));
vi.mock('@/lib/data', () => ({ getDataClient: vi.fn() }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));

import Home from '@/app/page';

describe('homepage landmark', () => {
  it('renders the dashboard outer shell as the main landmark', () => {
    render(<Home />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
