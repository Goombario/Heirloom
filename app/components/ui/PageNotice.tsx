'use client';

import { createContext, useContext } from 'react';

/**
 * An app-wide notice that belongs at the top of the page's own content, under its
 * header: the phone backup reminder (#1130). The layout provides it; `PageShell`
 * renders it after its `topBar`, so it scrolls with the page instead of sitting
 * above the header.
 */
const PageNoticeContext = createContext<React.ReactNode>(null);

export const PageNoticeProvider = PageNoticeContext.Provider;

export function usePageNotice(): React.ReactNode {
  return useContext(PageNoticeContext);
}
