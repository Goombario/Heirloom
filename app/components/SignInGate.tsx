'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { useDesktopMode, useDesktopModeResolved } from '@/app/hooks/useDesktopMode';
import { DATA_MODE } from '@/lib/data';

/**
 * On the hosted web build, sends a visitor who isn't signed in to the sign-in
 * page, at any width, and back to the page they asked for afterwards. Before
 * #933 only mobile was sent; desktop Home sat on loading placeholders, since
 * every API call answers 401 without a session. Renders nothing.
 *
 * Excluded in local/static (PGlite) and desktop builds, which have no auth (it
 * waits until desktop detection has answered), and skipped on the /auth/*
 * pages themselves.
 */
export default function SignInGate() {
  const { status } = useSession();
  const isDesktop = useDesktopMode();
  const desktopResolved = useDesktopModeResolved();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (DATA_MODE === 'local' || !desktopResolved || isDesktop) return;
    if (status !== 'unauthenticated') return;
    if (pathname?.startsWith('/auth')) return;
    const callbackUrl = `${pathname ?? '/'}${window.location.search}`;
    router.replace(callbackUrl === '/' ? '/auth/signin' : `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }, [status, isDesktop, desktopResolved, pathname, router]);

  return null;
}
