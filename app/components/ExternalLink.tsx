'use client';

import React from 'react';
import { isDesktopApp, isWebUrl, openInSystemBrowser } from '@/lib/desktop';

type ExternalLinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'> & {
    href: string;
};

/**
 * A link that leaves Heirloom (#1020). On the web and in the static build it is
 * a plain new-tab link. In the desktop app a new tab would open inside the app
 * window, so it opens the system browser instead, and anything other than an
 * http(s) link does nothing rather than navigate the app away.
 */
export function ExternalLink({ href, onClick, children, ...rest }: ExternalLinkProps) {
    return (
        <a
            {...rest}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
                onClick?.(e);
                if (e.defaultPrevented || !isDesktopApp()) return;
                e.preventDefault();
                if (!isWebUrl(href)) return;
                openInSystemBrowser(href).catch((err: unknown) => {
                    console.error('Could not open the link in the system browser', err);
                });
            }}
        >
            {children}
        </a>
    );
}
