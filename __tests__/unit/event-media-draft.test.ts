import { describe, expect, it, vi } from 'vitest';
import {
  normalizeEventMediaDraftError,
  processEventMediaDraft,
  type EventMediaDraftItem,
} from '@/app/components/media/event-media-draft';

function fileItem(key: string, intent = `intent-${key}`): EventMediaDraftItem {
  return { key, kind: 'file', file: new File([key], `${key}.jpg`, { type: 'image/jpeg' }), uploadIntentId: intent };
}

describe('processEventMediaDraft', () => {
  it('attempts every item and reports successes separately from retryable failures', async () => {
    const client = {
      linkToOwner: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('temporary')),
      upload: vi.fn().mockResolvedValue({ Id: 3 }),
    };
    const items: EventMediaDraftItem[] = [
      { key: 'existing-1', kind: 'existing', mediaId: 11 },
      { key: 'existing-2', kind: 'existing', mediaId: 12 },
      fileItem('file-1', 'stable-intent'),
    ];

    const result = await processEventMediaDraft({ eventId: 8, treeId: 4, items, client });

    expect(client.linkToOwner).toHaveBeenNthCalledWith(1, 11, 'Events', 8, 4);
    expect(client.linkToOwner).toHaveBeenNthCalledWith(2, 12, 'Events', 8, 4);
    expect(client.upload).toHaveBeenCalledWith(
      expect.objectContaining({ file: expect.any(File), ownerTable: 'Events', ownerRecordId: 8, uploadIntentId: 'stable-intent' }),
      4,
    );
    expect(result).toEqual({
      succeededKeys: ['existing-1', 'file-1'],
      failed: [{ key: 'existing-2', code: 'generic', retryable: true }],
    });
  });

  it('puts a person\'s new event files in their gallery too, but only links library picks to the event (#1204)', async () => {
    const client = { linkToOwner: vi.fn().mockResolvedValue(undefined), upload: vi.fn().mockResolvedValue({ Id: 3 }) };
    const items: EventMediaDraftItem[] = [{ key: 'existing-1', kind: 'existing', mediaId: 11 }, fileItem('file-1')];

    await processEventMediaDraft({ eventId: 8, treeId: 4, items, client, galleryPersonId: 21 });

    expect(client.linkToOwner).toHaveBeenCalledWith(11, 'Events', 8, 4);
    expect(client.upload).toHaveBeenCalledWith(expect.objectContaining({ ownerTable: 'Events', ownerRecordId: 8, personId: 21 }), 4);
  });

  it('keeps non-retryable failures privacy-safe and never creates an event', async () => {
    const client = {
      linkToOwner: vi.fn().mockRejectedValue(new Error('duplicate key value violates unique constraint')),
      upload: vi.fn(),
      events: { create: vi.fn() },
    };
    const result = await processEventMediaDraft({
      eventId: 9,
      treeId: null,
      items: [{ key: 'existing', kind: 'existing', mediaId: 22 }],
      client,
    });

    expect(result.failed[0]).toEqual({ key: 'existing', code: 'generic', retryable: true });
    expect(client.events.create).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('duplicate key');
  });

  it('preserves the same upload intent when the caller retries a failed file', async () => {
    const client = { linkToOwner: vi.fn(), upload: vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ Id: 31 }) };
    const item = fileItem('retry-me', 'intent-that-must-stay');

    await processEventMediaDraft({ eventId: 10, treeId: 5, items: [item], client });
    await processEventMediaDraft({ eventId: 10, treeId: 5, items: [item], client });

    expect(client.upload).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ uploadIntentId: 'intent-that-must-stay' }),
      5,
    );
    expect(client.upload).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ uploadIntentId: 'intent-that-must-stay' }),
      5,
    );
  });
});

describe('normalizeEventMediaDraftError', () => {
  it('maps known errors to stable codes and retry policy', () => {
    expect(normalizeEventMediaDraftError({ code: 'upload_intent_conflict' })).toEqual({ code: 'upload_intent_conflict', retryable: false });
    expect(normalizeEventMediaDraftError({ name: 'StorageLimitError' })).toEqual({ code: 'storage_full', retryable: true });
    expect(normalizeEventMediaDraftError({ name: 'NotFoundError' })).toEqual({ code: 'not_found', retryable: false });
  });
});
