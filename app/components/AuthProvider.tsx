'use client';

import { SessionContext, SessionProvider } from 'next-auth/react';
import { type ReactNode } from 'react';
import { DATA_MODE } from '@/lib/data';

interface AuthProviderProps {
  children: ReactNode;
}

const localSession = {
  data: null,
  status: 'unauthenticated' as const,
  update: async () => null,
};

export function AuthProvider({ children }: AuthProviderProps) {
  if (DATA_MODE === 'local') {
    // There is no auth server in the static build. Using SessionProvider with
    // session={null} still fetches /api/auth/session during React Strict Mode's
    // development effect replay because Auth.js resets its module-level cache
    // in the intervening cleanup. An inert context provides the same local
    // useSession() contract without mounting Auth.js's fetch/sync effects.
    return (
      <SessionContext.Provider value={localSession}>
        {children}
      </SessionContext.Provider>
    );
  }
  return <SessionProvider>{children}</SessionProvider>;
}
