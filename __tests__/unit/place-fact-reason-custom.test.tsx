/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import en from '@/messages/en.json';

// Places phrasing for custom event types (#162, #16): a custom label shows as
// typed inside a neutral template; standard types keep their verb phrases.

vi.mock('next-intl', async (orig) => {
  const actual = await orig<typeof import('next-intl')>();
  return {
    ...actual,
    useTranslations: (namespace: keyof typeof en) => {
      const t = actual.createTranslator({ locale: 'en', messages: en, namespace });
      return Object.assign(t, { has: (key: string) => key in (en[namespace] as Record<string, unknown>) });
    },
  };
});
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/date-input/aliases', () => ({ useDateQualifierWords: () => undefined }));
vi.mock('@/lib/date-utils', () => ({ formatDateForDisplay: (d: string) => d }));

import { usePlaceFactReason } from '@/app/places/usePlaceFactReason';


describe('usePlaceFactReason custom events (#162)', () => {
  const { result } = renderHook(() => usePlaceFactReason());
  const reason = (eventType: string, date: string | null = '1917') => result.current({ kind: 'event', eventType, date, sex: 'M' });

  it('puts a custom label, as typed, in the neutral template', () => {
    expect(reason('Military service')).toBe('Military service here, 1917');
    expect(reason('Military service', null)).toBe('Military service here');
  });

  it('gives standard types without a verb before a proper phrase (#16)', () => {
    expect(reason('GRAD', '1920')).toBe('Graduated here 1920');
    expect(reason('DIV', '1950')).toBe('Divorced here 1950');
    expect(reason('RESI', '1901')).toBe('Resided here 1901');
  });
});
