/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Media } from '@/lib/db/schema';

const mobile = vi.hoisted(() => ({ value: true }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key, useLocale: () => 'en' }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value }));
vi.mock('@/app/components/lightbox/MobileLightbox', () => ({ default: () => <div data-testid="mobile-lightbox" /> }));
vi.mock('@/app/components/lightbox/PhotoStage', () => ({ default: () => null }));
vi.mock('@/app/components/lightbox/EvidencePanel', () => ({ default: () => null }));
vi.mock('@/app/components/lightbox/WhoIsThisModal', () => ({ default: () => null }));
vi.mock('@/lib/data', () => ({ DATA_MODE: 'http', getDataClient: async () => ({ media: { listTags: async () => [] } }) }));

import MediaLightbox from '@/app/components/lightbox/MediaLightbox';
import { sheetsTakeBack } from '@/app/components/ui/sheetStack';

const items = [{ Id: 10, Title: 'Photo', MimeType: 'image/jpeg' }] as unknown as Media[];

describe('MediaLightbox and the phone Back (#1053)', () => {
  it('closes on a phone when Back is pressed, instead of leaving the page', () => {
    mobile.value = true;
    const onClose = vi.fn();
    const { unmount } = render(<MediaLightbox items={items} index={0} treeId={1} canDelete={false} onClose={onClose} onChangeIndex={vi.fn()} />);
    expect(sheetsTakeBack()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(sheetsTakeBack()).toBeNull();
  });

  it('leaves Back to the browser on desktop', () => {
    mobile.value = false;
    const onClose = vi.fn();
    render(<MediaLightbox items={items} index={0} treeId={1} canDelete={false} onClose={onClose} onChangeIndex={vi.fn()} />);
    expect(sheetsTakeBack()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
