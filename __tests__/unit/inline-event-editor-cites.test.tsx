/**
 * @vitest-environment happy-dom
 *
 * #192: the Add an event composer shows a Sources row. Sources picked there are
 * queued and written as citations right after the event is created.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const h = vi.hoisted(() => ({
    eventsCreate: vi.fn(),
    peopleUpdate: vi.fn(),
    citationsCreate: vi.fn(),
    sourcesCreate: vi.fn(),
    saved: vi.fn(),
    refresh: vi.fn(),
    sidebarProps: null as null | { factTable: string; factId: number | null; onPending?: (p: unknown) => void; onClose: () => void },
}));

const client = {
    events: { create: h.eventsCreate, update: vi.fn(), remove: vi.fn() },
    media: { linkToOwner: vi.fn(), upload: vi.fn() },
    places: { pinChains: vi.fn().mockResolvedValue({}), geocodeUpsert: vi.fn(), geocodeUpsertHierarchy: vi.fn() },
    people: { update: h.peopleUpdate },
    notes: { create: vi.fn() },
    citations: { create: h.citationsCreate },
    sources: { create: h.sourcesCreate },
};

vi.mock('@/lib/data', () => ({ getDataClient: () => Promise.resolve(client) }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 99, activePermission: 'owner' }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string, v?: Record<string, unknown>) => (v?.title ? `${key}:${v.title}` : key) }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }) }));
vi.mock('@/app/components/LocationField', () => ({
    __esModule: true,
    default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
        <input aria-label="place" value={value} onChange={(e) => onChange(e.target.value)} />
    ),
}));
vi.mock('@/app/components/media/OwnerMediaCard', () => ({ OwnerMediaCard: () => <div /> }));
vi.mock('@/app/components/media/EventMediaDraftPanel', () => ({ default: () => <div /> }));
vi.mock('@/app/components/AttachSourceSidebar', () => ({
    default: (props: NonNullable<typeof h.sidebarProps>) => {
        h.sidebarProps = props;
        return (
            <div role="dialog" aria-label="attach source">
                <button type="button" onClick={() => { props.onPending?.({ factTable: props.factTable, factLabel: 'x', page: 'p. 4', sourceId: 31, sourceTitle: '1891 census' }); props.onClose(); }}>pick existing</button>
                <button type="button" onClick={() => { props.onPending?.({ factTable: props.factTable, factLabel: 'x', page: null, newSource: { Title: 'Parish book', Type: 'Church', Author: null, RepositoryName: null, CallNumber: null, Text: null, PublicationInfo: null, Contents: null } }); props.onClose(); }}>pick new</button>
            </div>
        );
    },
}));

import InlineEventEditor from '@/app/components/InlineEventEditor';

beforeEach(() => {
    h.eventsCreate.mockResolvedValue({ Id: 701, Type: 'RESI', Date: null, Place: null, Description: null, PersonId: 4, FamilyId: null, PlaceId: null });
    h.peopleUpdate.mockResolvedValue({ BirthPlaceId: null, DeathPlaceId: null });
    h.citationsCreate.mockResolvedValue({ Id: 1 });
    h.sourcesCreate.mockResolvedValue({ Id: 77 });
    h.sidebarProps = null;
});
afterEach(() => vi.clearAllMocks());

async function queue(user: ReturnType<typeof userEvent.setup>, which: 'pick existing' | 'pick new') {
    await user.click(screen.getByRole('button', { name: /attach_source/ }));
    await user.click(screen.getByRole('button', { name: which }));
}

describe('Add an event: cite pins (#192)', () => {
    it('shows the Sources row and an empty pin in the composer', () => {
        render(<InlineEventEditor target={{ kind: 'person', personId: 4 }} defaultType="RESI" onCancel={vi.fn()} onSaved={h.saved} />);
        expect(screen.getByText('field_sources')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /attach_source/ })).toBeInTheDocument();
    });

    it('writes queued sources on the new event once it is created', async () => {
        const user = userEvent.setup();
        render(<InlineEventEditor target={{ kind: 'person', personId: 4 }} defaultType="RESI" onCancel={vi.fn()} onSaved={h.saved} />);
        await queue(user, 'pick existing');
        await queue(user, 'pick new');
        expect(h.sidebarProps?.factId).toBeNull();
        expect(screen.getByText('1891 census')).toBeInTheDocument();
        expect(screen.getByText('Parish book')).toBeInTheDocument();
        expect(h.citationsCreate).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'add_event' }));
        await waitFor(() => expect(h.saved).toHaveBeenCalledTimes(1));
        expect(h.eventsCreate).toHaveBeenCalledTimes(1);
        expect(h.citationsCreate).toHaveBeenCalledWith(expect.objectContaining({ FactTable: 'Events', FactId: 701, SourceId: 31, Page: 'p. 4' }), 99);
        expect(h.sourcesCreate).toHaveBeenCalledWith(expect.objectContaining({ Title: 'Parish book' }), 99);
        expect(h.citationsCreate).toHaveBeenCalledWith(expect.objectContaining({ FactTable: 'Events', FactId: 701, SourceId: 77 }), 99);
    });

    it('a source taken off before saving is not written', async () => {
        const user = userEvent.setup();
        render(<InlineEventEditor target={{ kind: 'family', familyId: 9 }} defaultType="ENGA" onCancel={vi.fn()} onSaved={h.saved} />);
        await queue(user, 'pick existing');
        await user.click(screen.getByRole('button', { name: 'remove_pending_source:1891 census' }));
        await user.click(screen.getByRole('button', { name: 'add_event' }));
        await waitFor(() => expect(h.saved).toHaveBeenCalled());
        expect(h.citationsCreate).not.toHaveBeenCalled();
    });

    it('a birth added in the composer cites the person\'s birth fact', async () => {
        const user = userEvent.setup();
        render(<InlineEventEditor target={{ kind: 'person', personId: 4 }} defaultType="BIRT" allowVital={{ birth: true, death: true }} onCancel={vi.fn()} onSaved={h.saved} />);
        await queue(user, 'pick existing');
        await user.click(screen.getByRole('button', { name: 'add_event' }));
        await waitFor(() => expect(h.saved).toHaveBeenCalled());
        expect(h.eventsCreate).not.toHaveBeenCalled();
        expect(h.citationsCreate).toHaveBeenCalledWith(expect.objectContaining({ FactTable: 'PersonBirth', FactId: 4, SourceId: 31 }), 99);
    });

    it('keeps a source that failed queued and the editor open', async () => {
        const user = userEvent.setup();
        h.citationsCreate.mockRejectedValueOnce(new Error('offline'));
        render(<InlineEventEditor target={{ kind: 'person', personId: 4 }} defaultType="RESI" onCancel={vi.fn()} onSaved={h.saved} onRefresh={h.refresh} />);
        await queue(user, 'pick existing');
        await user.click(screen.getByRole('button', { name: 'add_event' }));
        await waitFor(() => expect(screen.getByText('sources_failed')).toBeInTheDocument());
        expect(h.saved).not.toHaveBeenCalled();
        expect(screen.getByText('1891 census')).toBeInTheDocument();
    });
});
