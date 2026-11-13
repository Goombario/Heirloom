'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useLanguage } from '@/app/components/LanguageProvider';
import { formatActivityTime, formatDayTime, formatTimestamp, type TimestampStyle } from '@/lib/utils/format-datetime';

/**
 * Timestamp formatters bound to the app's language and time zone (#699).
 * `timestamp` is the absolute form; `activityTime` is for activity feeds
 * (relative under 24 hours, absolute date after); `dayTime` is a log row's
 * one-line time ("Today 14:02").
 */
export function useTimestamp() {
  const { language, timezone } = useLanguage();
  const t = useTranslations('common');
  const timestamp = useCallback(
    (value: Date | string, style?: TimestampStyle) => formatTimestamp(value, timezone, language, style),
    [timezone, language],
  );
  const activityTime = useCallback(
    (value: Date | string) => formatActivityTime(value, timezone, language, t),
    [timezone, language, t],
  );
  const dayTime = useCallback(
    (value: Date | string) => formatDayTime(value, timezone, language, t),
    [timezone, language, t],
  );
  return { timestamp, activityTime, dayTime };
}
