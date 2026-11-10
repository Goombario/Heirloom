'use client';

import { useTranslations } from 'next-intl';
import { ChevronsUpDown } from '@/lib/icons';
import { Select } from '@/app/components/ui/Select';
import type { PhotoSort } from '@/app/library/usePhotoFilters';

interface LibraryPhotoSortProps {
  sort: PhotoSort;
  setSort: (sort: PhotoSort) => void;
  isMobile?: boolean;
}

/** One sort control shared by the desktop toolbar and mobile 44px trigger. */
export default function LibraryPhotoSort({ sort, setSort, isMobile = false }: LibraryPhotoSortProps) {
  const t = useTranslations('library');
  const options = [
    { key: 'recent', value: 'recent' as const, label: t('photo_sort_recent') },
    { key: 'title-asc', value: 'title-asc' as const, label: t('photo_sort_title_asc') },
    { key: 'title-desc', value: 'title-desc' as const, label: t('photo_sort_title_desc') },
    { key: 'size-desc', value: 'size-desc' as const, label: t('photo_sort_largest') },
  ];
  const selectedLabel = options.find(option => option.value === sort)?.label ?? options[0].label;

  return (
    <Select
      label={t('photo_sort_label')}
      ariaLabel={isMobile ? t('photo_sort_trigger', { order: selectedLabel }) : undefined}
      valueLabel={isMobile ? <span className="sr-only">{selectedLabel}</span> : selectedLabel}
      options={options}
      isSelected={(value) => value === sort}
      onSelect={setSort}
      icon={<ChevronsUpDown size={15} aria-hidden="true" />}
      triggerClassName={isMobile
        ? 'h-11 w-11 min-h-11 min-w-11 justify-center gap-0 px-0 [&>span]:sr-only [&>svg:last-child]:hidden'
        : 'min-h-9 [&>span:first-of-type]:sr-only'}
      optionClassName="min-h-11"
    />
  );
}
