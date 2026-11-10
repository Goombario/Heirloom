/** @vitest-environment happy-dom */

import React, { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/data', () => ({ DATA_MODE: 'local' }));

import { useSession } from 'next-auth/react';
import { AuthProvider } from '@/app/components/AuthProvider';

function SessionConsumer() {
  const session = useSession();
  return <div>{`${session.status}:${String(session.data)}`}</div>;
}

describe('AuthProvider in local data mode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('provides an inert unauthenticated session without fetching during Strict Mode replay', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <StrictMode>
        <AuthProvider>
          <SessionConsumer />
        </AuthProvider>
      </StrictMode>,
    );

    expect(screen.getByText('unauthenticated:null')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
