/**
 * @vitest-environment happy-dom
 *
 * RED coverage for Batch 6 Task 7.  The draft panel is a deliberate component
 * boundary: the editor is exercised as real code while the panel exposes the
 * staged rows and retry action without coupling these tests to Task 6's visual
 * implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

type TestDraft = {
    items: Array<{ key: string; kind: 'existing' | 'file' }>;
    addExisting: (ids: readonly number[]) => void;
    addFiles: (files: readonly File[]) => void;
    process?: (eventId: number) => Promise<unknown>;
};
type TestPanelProps = {
    draft?: TestDraft;
    ownerId?: number;
    status?: string;
    error?: string;
    onRetry?: (key: string) => void;
};

const h = vi.hoisted(() => ({
    eventsCreate: vi.fn(),
    eventsUpdate: vi.fn(),
    eventsRemove: vi.fn(),
    mediaLinkToOwner: vi.fn(),
    mediaUpload: vi.fn(),
    placesPinChains: vi.fn(),
    refresh: vi.fn(),
    saved: vi.fn(),
    peopleUpdate: vi.fn(),
    cancelled: vi.fn(),
    panelProps: null as TestPanelProps | null,
}));

const client = {
    events: { create: h.eventsCreate, update: h.eventsUpdate, remove: h.eventsRemove },
    media: { linkToOwner: h.mediaLinkToOwner, upload: h.mediaUpload },
    places: { pinChains: h.placesPinChains, geocodeUpsert: vi.fn(), geocodeUpsertHierarchy: vi.fn() },
    people: { update: h.peopleUpdate },
    notes: { create: vi.fn() },
};

vi.mock('@/lib/data', () => ({ getDataClient: () => Promise.resolve(client) }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 99 }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }) }));
vi.mock('@/app/components/LocationField', () => ({
    __esModule: true,
    default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
        <input aria-label="place" placeholder="place" value={value} onChange={(e) => onChange(e.target.value)} />
    ),
}));
vi.mock('@/app/components/media/OwnerMediaCard', () => ({ OwnerMediaCard: () => <div data-testid="owner-media-card" /> }));

vi.mock('@/app/components/media/EventMediaDraftPanel', () => ({
    default: (props: TestPanelProps) => {
        h.panelProps = props;
        const draft = props.draft;
        const items = draft?.items ?? [];
        return (
            <section aria-label="event media draft" data-testid="event-media-draft-panel">
                <span data-testid="draft-status">{props.status ?? ''}</span>
                <span data-testid="draft-error">{props.error ?? ''}</span>
                {items.map((item: { key: string; kind: string }) => (
                    <span data-testid={`draft-item-${item.key}`} key={item.key}>{item.kind}</span>
                ))}
                <button type="button" onClick={() => props.onRetry ? props.onRetry('file-1') : void draft?.process?.(props.ownerId ?? 701)}>retry_attachments</button>
                <button type="button" onClick={() => draft?.addExisting([11])}>stage_existing_media</button>
                <button type="button" onClick={() => draft?.addFiles([new File(['file'], `portrait-${draft.items.filter(item => item.kind === 'file').length}.jpg`, { type: 'image/jpeg' })])}>stage_file</button>
            </section>
        );
    },
}));

import InlineEventEditor from '@/app/components/InlineEventEditor';

/** The desktop event panel's save button: "Add event" for a new event, "Save changes" for an edit. */
const SAVE = /^(add_event|save_changes)$/;

const event = (id: number, target: { personId?: number; familyId?: number } = { personId: 4 }) => ({
    Id: id,
    UserId: 1,
    TreeId: 99,
    Type: 'BAPM',
    Date: '1984',
    Place: 'Dover',
    Description: 'Original description',
    PersonId: target.personId ?? null,
    FamilyId: target.familyId ?? null,
});
const media = (id: number) => ({
    Id: id,
    UserId: 1,
    TreeId: 99,
    Title: null,
    FilePath: null,
    Format: 'jpg',
    ContentType: 'image/jpeg',
    FocalX: 50,
    FocalY: 50,
    FocalRadius: null,
    FileSize: 5,
    ContentHash: null,
    UploadIntentId: null,
});

function renderNew(target: { kind: 'person'; personId: number } | { kind: 'family'; familyId: number }) {
    return render(<InlineEventEditor target={target} defaultType={target.kind === 'person' ? 'RESI' : 'ENGA'} onCancel={h.cancelled} onSaved={h.saved} {...({ onRefresh: h.refresh } as Record<string, unknown>)} />);
}

async function stageExistingAndFiles(user: ReturnType<typeof userEvent.setup>, fileCount = 1) {
    await user.click(screen.getByText('stage_existing_media'));
    for (let i = 0; i < fileCount; i++) await user.click(screen.getByText('stage_file'));
    await waitFor(() => expect(screen.getByTestId('draft-item-media-11')).toBeInTheDocument());
}

beforeEach(() => {
    h.eventsCreate.mockResolvedValue(event(701));
    h.eventsUpdate.mockResolvedValue(event(701));
    h.mediaLinkToOwner.mockResolvedValue(undefined);
    h.mediaUpload.mockResolvedValue(media(801));
    h.placesPinChains.mockResolvedValue({});
    h.panelProps = null;
});

afterEach(() => vi.clearAllMocks());

describe('InlineEventEditor — create-once event/media attachment flow (Batch 6 Task 7)', () => {
    it('creates a new person event once with no media and replaces the save-first hint with the draft panel', async () => {
        const user = userEvent.setup();
        renderNew({ kind: 'person', personId: 4 });

        expect(screen.getByTestId('event-media-draft-panel')).toBeInTheDocument();
        expect(screen.queryByText('media_save_first')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: SAVE }));

        await waitFor(() => expect(h.eventsCreate).toHaveBeenCalledTimes(1));
        expect(h.eventsUpdate).not.toHaveBeenCalled();
        await waitFor(() => expect(h.saved).toHaveBeenCalledTimes(1));
    });

    it('creates a new family event once with no media and passes the family owner', async () => {
        const user = userEvent.setup();
        renderNew({ kind: 'family', familyId: 22 });
        await user.click(screen.getByRole('button', { name: SAVE }));

        await waitFor(() => expect(h.eventsCreate).toHaveBeenCalledTimes(1));
        expect(h.eventsCreate.mock.calls[0][0]).toMatchObject({ FamilyId: 22, PersonId: null });
    });

    it('creates once, processes staged existing media and files, and completes normally on mixed success', async () => {
        const user = userEvent.setup();
        renderNew({ kind: 'person', personId: 4 });
        await stageExistingAndFiles(user);
        await user.click(screen.getByRole('button', { name: SAVE }));

        await waitFor(() => expect(h.eventsCreate).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(h.mediaLinkToOwner).toHaveBeenCalledWith(11, 'Events', 701, 99));
        await waitFor(() => expect(h.mediaUpload).toHaveBeenCalledTimes(1));
        expect(h.eventsCreate).toHaveBeenCalledTimes(1);
        expect(h.mediaUpload.mock.calls[0][0]).toMatchObject({ ownerTable: 'Events', ownerRecordId: 701, uploadIntentId: expect.any(String) });
        expect(h.saved).toHaveBeenCalledTimes(1);
        expect(h.eventsCreate.mock.calls[0][0]).toMatchObject({ PersonId: 4, FamilyId: null });
    });

    it('keeps the persisted editor open after total attachment failure and announces that the event was saved', async () => {
        const user = userEvent.setup();
        h.mediaLinkToOwner.mockRejectedValue(new Error('link unavailable'));
        h.mediaUpload.mockRejectedValue(new Error('upload unavailable'));
        renderNew({ kind: 'person', personId: 4 });
        await stageExistingAndFiles(user);
        await user.click(screen.getByRole('button', { name: SAVE }));

        await waitFor(() => expect(h.eventsCreate).toHaveBeenCalledTimes(1));
        expect(screen.getByTestId('event-media-draft-panel')).toBeInTheDocument();
        expect(h.panelProps?.ownerId).toBe(701);
        expect(screen.getByTestId('draft-item-media-11')).toBeInTheDocument();
        expect(screen.getByTestId('draft-item-file-0')).toBeInTheDocument();
        expect(screen.getByText(/saved/i)).toBeInTheDocument();
        expect(h.mediaLinkToOwner).toHaveBeenCalledTimes(1);
        expect(h.mediaUpload).toHaveBeenCalledTimes(1);
        expect(h.saved).not.toHaveBeenCalled();
        expect(h.refresh).toHaveBeenCalled();
    });

    it('retains only failed draft items and retries attachments without repeating successful links/uploads or creating another event', async () => {
        const user = userEvent.setup();
        h.mediaUpload
            .mockResolvedValueOnce(media(801))
            .mockRejectedValueOnce(new Error('temporary upload failure'))
            .mockResolvedValueOnce(media(802));
        renderNew({ kind: 'person', personId: 4 });
        await stageExistingAndFiles(user, 2);
        await user.click(screen.getByRole('button', { name: SAVE }));
        await waitFor(() => expect(h.mediaUpload).toHaveBeenCalledTimes(2));

        // The parent must update the draft view while preserving the mounted editor.
        await waitFor(() => expect(screen.queryByTestId('draft-item-media-11')).not.toBeInTheDocument());
        expect(screen.queryByTestId('draft-item-file-0')).not.toBeInTheDocument();
        expect(screen.getByTestId('draft-item-file-1')).toBeInTheDocument();
        await user.click(screen.getByText('retry_attachments'));

        await waitFor(() => expect(h.mediaUpload).toHaveBeenCalledTimes(3));
        expect(h.eventsCreate).toHaveBeenCalledTimes(1);
        expect(h.mediaLinkToOwner).toHaveBeenCalledTimes(1);
        expect(h.mediaUpload.mock.calls[2][0]).toMatchObject({ ownerTable: 'Events', ownerRecordId: 701 });
        await waitFor(() => expect(h.saved).toHaveBeenCalledTimes(1));
    });

    it('uses update, not create, when fields are edited after creation while attachments are still processing', async () => {
        const user = userEvent.setup();
        let resolveAttachments!: (outcome: unknown) => void;
        h.mediaUpload.mockReturnValueOnce(new Promise((resolve) => { resolveAttachments = resolve; }));
        renderNew({ kind: 'person', personId: 4 });
        await user.click(screen.getByText('stage_file'));
        await user.click(screen.getByRole('button', { name: SAVE }));
        await waitFor(() => expect(h.eventsCreate).toHaveBeenCalledTimes(1));

        await user.clear(screen.getByPlaceholderText('place'));
        await user.type(screen.getByPlaceholderText('place'), 'York');
        await user.click(screen.getByRole('button', { name: SAVE }));
        await waitFor(() => expect(h.eventsUpdate).toHaveBeenCalledWith(701, expect.objectContaining({ Place: 'York' }), 99));
        expect(h.eventsCreate).toHaveBeenCalledTimes(1);
        resolveAttachments(media(803));
    });

    it('keeps unsaved field edits when slow attachment completion succeeds', async () => {
        const user = userEvent.setup();
        let resolveAttachments!: (outcome: unknown) => void;
        h.mediaUpload.mockReturnValueOnce(new Promise((resolve) => { resolveAttachments = resolve; }));
        renderNew({ kind: 'person', personId: 4 });
        await user.click(screen.getByText('stage_file'));
        await user.click(screen.getByRole('button', { name: SAVE }));
        await waitFor(() => expect(h.eventsCreate).toHaveBeenCalledTimes(1));
        await user.clear(screen.getByPlaceholderText('place'));
        await user.type(screen.getByPlaceholderText('place'), 'York');

        resolveAttachments(media(804));

        await waitFor(() => expect(h.mediaUpload).toHaveBeenCalledTimes(1));
        expect(h.saved).not.toHaveBeenCalled();
        expect(screen.getByDisplayValue('York')).toBeInTheDocument();
    });

    it('closes exactly once when dirty fields are saved after attachments succeed', async () => {
        const user = userEvent.setup();
        let resolveAttachments!: (outcome: unknown) => void;
        h.mediaUpload.mockReturnValueOnce(new Promise((resolve) => { resolveAttachments = resolve; }));
        renderNew({ kind: 'person', personId: 4 });
        await user.click(screen.getByText('stage_file'));
        await user.click(screen.getByRole('button', { name: SAVE }));
        await waitFor(() => expect(h.eventsCreate).toHaveBeenCalledTimes(1));
        await user.clear(screen.getByPlaceholderText('place'));
        await user.type(screen.getByPlaceholderText('place'), 'York');

        resolveAttachments(media(806));
        await waitFor(() => expect(screen.queryByTestId('draft-item-file-0')).not.toBeInTheDocument());
        expect(screen.getByTestId('owner-media-card')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: SAVE }));

        await waitFor(() => expect(h.eventsUpdate).toHaveBeenCalledTimes(1));
        expect(h.saved).toHaveBeenCalledTimes(1);
    });

    it('waits for a pending field update before closing after attachment completion', async () => {
        const user = userEvent.setup();
        let resolveAttachments!: (outcome: unknown) => void;
        let resolveUpdate!: (event: unknown) => void;
        h.mediaUpload.mockReturnValueOnce(new Promise((resolve) => { resolveAttachments = resolve; }));
        h.eventsUpdate.mockReturnValueOnce(new Promise((resolve) => { resolveUpdate = resolve; }));
        renderNew({ kind: 'person', personId: 4 });
        await user.click(screen.getByText('stage_file'));
        await user.click(screen.getByRole('button', { name: SAVE }));
        await waitFor(() => expect(h.eventsCreate).toHaveBeenCalledTimes(1));
        await user.clear(screen.getByPlaceholderText('place'));
        await user.type(screen.getByPlaceholderText('place'), 'York');
        await user.click(screen.getByRole('button', { name: SAVE }));
        await waitFor(() => expect(h.eventsUpdate).toHaveBeenCalledTimes(1));

        resolveAttachments(media(805));
        await waitFor(() => expect(h.mediaUpload).toHaveBeenCalledTimes(1));
        expect(h.saved).not.toHaveBeenCalled();

        resolveUpdate(event(701, { personId: 4 }));
        await waitFor(() => expect(h.saved).toHaveBeenCalledTimes(1));
    });

    it('does not delete a persisted event when cancel is pressed after creation', async () => {
        const user = userEvent.setup();
        h.mediaUpload.mockReturnValue(new Promise(() => undefined));
        renderNew({ kind: 'person', personId: 4 });
        await user.click(screen.getByText('stage_file'));
        await user.click(screen.getByRole('button', { name: SAVE }));
        await waitFor(() => expect(h.eventsCreate).toHaveBeenCalledTimes(1));

        await user.click(screen.getByText('cancel'));
        expect(h.cancelled).toHaveBeenCalledTimes(1);
        expect(h.eventsRemove).not.toHaveBeenCalled();
        expect(h.eventsCreate).toHaveBeenCalledTimes(1);
    });

    it('keeps synthetic vital rows unchanged: no draft panel or media hint is rendered', () => {
        render(
            <InlineEventEditor
                target={{ kind: 'person', personId: 4 }}
                event={{ ...event(0), Place: null }}
                vitalLock="BIRT"
                onCancel={h.cancelled}
                onSaved={h.saved}
            />,
        );
        expect(screen.queryByTestId('event-media-draft-panel')).not.toBeInTheDocument();
        expect(screen.queryByText('media_save_first')).not.toBeInTheDocument();
    });
});

describe('InlineEventEditor — add-event Birth/Death has no media box (#927)', () => {
    it('offers no media box for an add-event Birth and saves the vital without touching media', async () => {
        const user = userEvent.setup();
        h.peopleUpdate.mockResolvedValue({});
        render(<InlineEventEditor target={{ kind: 'person', personId: 4 }} defaultType="BIRT" onCancel={h.cancelled} onSaved={h.saved} />);

        expect(screen.queryByTestId('event-media-draft-panel')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: SAVE }));

        await waitFor(() => expect(h.saved).toHaveBeenCalledTimes(1));
        expect(h.peopleUpdate).toHaveBeenCalledTimes(1);
        expect(h.eventsCreate).not.toHaveBeenCalled();
        expect(h.mediaLinkToOwner).not.toHaveBeenCalled();
        expect(h.mediaUpload).not.toHaveBeenCalled();
    });

    it('blocks Save when media was staged before switching the type to Death', async () => {
        const user = userEvent.setup();
        render(<InlineEventEditor target={{ kind: 'person', personId: 4 }} allowVital={{ birth: true, death: true }} onCancel={h.cancelled} onSaved={h.saved} />);
        // The desktop panel starts on the type chips; Change type goes back to them.
        await user.click(screen.getByRole('button', { name: 'RESI' }));
        await stageExistingAndFiles(user);

        await user.click(screen.getByRole('button', { name: 'change_type' }));
        await user.click(screen.getByRole('button', { name: 'DEAT' }));

        expect(screen.getByTestId('event-media-draft-panel')).toBeInTheDocument();
        expect(screen.getByText('vital_media_unsupported')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: SAVE }));
        expect(h.peopleUpdate).not.toHaveBeenCalled();
        expect(h.saved).not.toHaveBeenCalled();
    });
});
