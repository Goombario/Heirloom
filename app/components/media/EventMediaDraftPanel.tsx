'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Card, SectionHeader } from '@/app/components/ui';
import MediaImg from '@/app/components/MediaImg';
import { ImageUp } from '@/lib/icons';
import { classifyUpload } from '@/lib/media/allowed-extensions';
import type { EventMediaDraftController } from './useEventMediaDraft';
import type { EventMediaDraftFailure } from './event-media-draft';
import AddMediaModal from './AddMediaModal';
import { NewFileImage } from './add-media/AddMediaTile';

export interface EventMediaDraftPanelProps {
  treeId: number | null;
  draft: EventMediaDraftController;
  /** Existing event ID, when this panel is reused after create. */
  ownerId?: number;
  relevantPersonIds?: readonly number[];
  /** A person's life event: new uploads also go in their gallery. */
  galleryPersonId?: number;
  /** Add media's "To {name} · {part}" line. */
  targetName?: string | null;
  targetPart?: string | null;
  onRetry?: (key: string) => void;
}

/**
 * The media of an event that isn't saved yet: Add media (#1204) stages new files and
 * library picks here, and nothing is written until the event saves. The modal's own
 * duplicate check has already swapped a file the library holds for its library copy.
 */
export default function EventMediaDraftPanel({ treeId, draft, ownerId, relevantPersonIds, galleryPersonId, targetName, targetPart, onRetry }: EventMediaDraftPanelProps) {
  const t = useTranslations('eventMediaDraft');
  const tc = useTranslations('common');
  const tm = useTranslations('ownerMedia');
  const [addOpen, setAddOpen] = useState(false);
  const titleId = `event-media-draft-title-${useId()}`;

  function failureText(failure: EventMediaDraftFailure) {
    return `${t('error_prefix')}: ${t(`error_${failure.code}`)}`;
  }

  return (
    <Card role="region" aria-labelledby={titleId} className="space-y-3">
      <SectionHeader level="rail" headingId={titleId} title={t('title')} />

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setAddOpen(true)}>
          <ImageUp className="w-4 h-4" aria-hidden="true" /> {tm('add_button')}
        </Button>
      </div>

      {draft.items.length === 0 ? (
        <p className="text-sm text-text-muted">{t('empty')}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {draft.items.map(item => {
            const failure = draft.failures.find(f => f.key === item.key);
            if (item.kind === 'existing') return (
              <div key={item.key} className="flex flex-col gap-1.5 min-w-0">
                <div className="relative aspect-square rounded-xl overflow-hidden border border-border">
                  <MediaImg mediaId={item.mediaId} treeId={treeId} width={256} alt={t('existing_alt')} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <span className="text-xs text-text-secondary truncate">{t('existing', { id: item.mediaId })}</span>
                {failure && <FailureRow failure={failure} text={failureText(failure)} onRetry={onRetry} t={t} />}
                <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-xs text-error underline underline-offset-2 focus-ring" onClick={() => draft.remove(item.key)}>{tc('remove')}</button>
              </div>
            );
            return (
              <div key={item.key} className="flex flex-col gap-1.5 min-w-0">
                <div className="relative aspect-square rounded-xl overflow-hidden border border-border">
                  <StagedFileThumb file={item.file} />
                </div>
                <span className="text-xs text-text-secondary truncate" title={item.file.name}>{t('file_label', { name: item.file.name })}</span>
                {failure && <FailureRow failure={failure} text={failureText(failure)} onRetry={onRetry} t={t} />}
                <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-xs text-error underline underline-offset-2 focus-ring" onClick={() => draft.remove(item.key)}>{tc('remove')}</button>
              </div>
            );
          })}
        </div>
      )}

      {addOpen && (
        <AddMediaModal
          target={{ kind: 'owner', ownerTable: 'Events', ownerId, galleryPersonId }}
          treeId={treeId}
          targetName={targetName}
          targetPart={targetPart}
          relevantPersonIds={relevantPersonIds}
          stagedMediaIds={draft.stagedMediaIds}
          onStage={({ files, mediaIds }) => { draft.addFiles(files); draft.addExisting(mediaIds); }}
          onClose={() => setAddOpen(false)}
          onAdded={() => setAddOpen(false)}
        />
      )}
    </Card>
  );
}

function FailureRow({ failure, text, onRetry, t }: { failure: EventMediaDraftFailure; text: string; onRetry?: (key: string) => void; t: (key: string) => string }) {
  return <div className="text-xs text-error" role="alert"><span>{text}</span>{failure.retryable && onRetry && <button type="button" className="ml-2 inline-flex min-h-11 min-w-11 items-center justify-center underline" onClick={() => onRetry(failure.key)}>{t('retry')}</button>}</div>;
}

/** A staged file's own preview URL, revoked when the file leaves the draft. */
function StagedFileThumb({ file }: { file: File }) {
  const document = classifyUpload(file.name, file.type) === 'pdf';
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (document) return;
    const url = URL.createObjectURL(file);
    // The URL exists only once the effect runs, so it can't be computed in render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, document]);
  return <NewFileImage preview={preview} document={document} />;
}
