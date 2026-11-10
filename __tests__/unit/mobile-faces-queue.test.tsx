/** @vitest-environment happy-dom */

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => {
    const t = (key: string, params?: Record<string, unknown>) => {
        const plain = params && Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v !== 'function'));
        return plain ? `${key}:${JSON.stringify(plain)}` : key;
    };
    return { useTranslations: () => Object.assign(t, { rich: t }) };
});
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('@/app/components/MediaImg', () => ({ default: () => null }));
vi.mock('@/app/components/PersonPickerSheet', () => ({
    PersonPickerSheet: ({ open, suggested }: { open: boolean; suggested?: { people: { FirstName: string }[] } }) => (
        open ? <div data-testid="picker">{suggested?.people.map(p => p.FirstName).join(', ')}</div> : null
    ),
}));

import { MobileFacesQueue } from '@/app/library/faces/MobileFacesQueue';
import type { FaceRowActions } from '@/app/library/faces/FaceDecisionRows';
import { buildFaceRows, NO_SPLITS } from '@/app/library/faces/faceRows';
import type { FaceGroup } from '@/lib/data/types';

const cand = (Id: number, MediaTitle: string, MediaDate: string) => ({ Id, MediaId: Id * 10, TreeId: 1, RegionX: 10, RegionY: 10, RegionW: 20, RegionH: 20, SourceName: 'Ada', SuggestedPersonId: 5, MatchKind: 'exact', Status: 'pending', ConfirmedTagId: null, DismissReason: null, MediaTitle, MediaDate });
const person = (id: number, name: string, birthYear: string) => ({ id, name, birthYear, deathYear: null, sex: 'F', mediaId: null, focalX: null, focalY: null, focalRadius: null });
const group = (over: Partial<FaceGroup>): FaceGroup => ({
    groupKey: 'ada', sourceName: 'Ada', matchKind: 'exact', suggestedPerson: person(5, 'Ada Example', '1880'), candidateCount: 2,
    candidates: [cand(1, 'Wedding', '1926'), cand(2, 'Farm', '1958')], ambiguousPersonCount: null, ambiguousCandidates: [], ...over,
} as unknown as FaceGroup);

let actions: FaceRowActions;
beforeEach(() => {
    actions = {
        canEdit: true, busy: false, treeId: 1,
        onPick: vi.fn(), onTag: vi.fn(), onDismiss: vi.fn(), onSplitNot: vi.fn(), onEachFace: vi.fn(), onOpenPhoto: vi.fn(),
    };
});

function renderQueue(groups: FaceGroup[], over: Partial<Parameters<typeof MobileFacesQueue>[0]> = {}) {
    const items = buildFaceRows(groups, NO_SPLITS, new Map()).map(row => ({ row }));
    return render(
        <MobileFacesQueue items={items} groups={groups} pendingTotal={2} resolvedView={false} onView={vi.fn()} loading={false} error={null}
            actions={actions} confirmAllCount={2} bulkBusy={false} onConfirmAll={vi.fn()} onUndo={vi.fn()} {...over} />,
    );
}

describe('MobileFacesQueue (#1156)', () => {
    it('shows a block with its person row, crops labelled by year, and a neutral Tag pill', () => {
        renderQueue([group({})]);
        const block = screen.getByTestId('face-block');
        expect(within(block).getByRole('heading', { name: 'Ada' })).toBeInTheDocument();
        expect(within(block).getByText('Ada Example')).toBeInTheDocument();
        expect(within(block).getByText('1926')).toBeInTheDocument();
        const tag = within(block).getByRole('button', { name: 'action_tag:{"count":2}' });
        expect(tag).not.toHaveClass('bg-primary');
        fireEvent.click(tag);
        expect(actions.onTag).toHaveBeenCalledWith(expect.objectContaining({ key: 'ada' }));
        fireEvent.click(within(block).getByRole('button', { name: 'action_cant_identify' }));
        expect(actions.onDismiss).toHaveBeenCalledWith(expect.objectContaining({ key: 'ada' }), expect.any(Array), 'unidentified');
        expect(screen.getByRole('button', { name: 'confirm_all:{"count":2}' })).toHaveClass('bg-primary');
    });

    it('shows a shared name as radio rows with the note, Someone else and Choose for each face; Tag waits for a pick', () => {
        const sharedBy = [person(21, 'Marie Gagnon', '1905'), person(22, 'Marie Ellis', '1931')];
        renderQueue([group({ matchKind: 'ambiguous', suggestedPerson: null, ambiguousPersonCount: 2, ambiguousCandidates: sharedBy })], { confirmAllCount: 0 });
        const block = screen.getByTestId('face-block');
        expect(within(block).getByRole('button', { name: 'action_tag:{"count":2}' })).toBeDisabled();
        expect(within(block).getAllByRole('radio')).toHaveLength(2);
        expect(within(block).getByText(/note_span/)).toBeInTheDocument();
        fireEvent.click(within(block).getByRole('radio', { name: /Marie Ellis/ }));
        expect(actions.onPick).toHaveBeenCalledWith(expect.objectContaining({ key: 'ada' }), sharedBy[1]);
        fireEvent.click(within(block).getByRole('button', { name: 'action_each_face' }));
        expect(actions.onEachFace).toHaveBeenCalled();
        fireEvent.click(within(block).getByRole('button', { name: 'someone_else' }));
        expect(screen.getByTestId('picker')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /confirm_all/ })).not.toBeInTheDocument();
    });

    it('gives viewers no actions', () => {
        actions.canEdit = false;
        renderQueue([group({})]);
        expect(screen.queryByRole('button', { name: /action_tag/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'action_cant_identify' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /confirm_all/ })).not.toBeInTheDocument();
    });

    it('opens one face in a sheet with its own actions', () => {
        renderQueue([group({})]);
        fireEvent.click(screen.getByRole('button', { name: 'show_photo:{"title":"Wedding"}' }));
        fireEvent.click(screen.getByRole('button', { name: /action_not_person/ }));
        expect(actions.onSplitNot).toHaveBeenCalledWith(expect.objectContaining({ key: 'ada' }), expect.objectContaining({ Id: 1 }));
    });

    it('opens the photo from the face sheet', () => {
        renderQueue([group({})]);
        fireEvent.click(screen.getByRole('button', { name: 'show_photo:{"title":"Farm"}' }));
        expect(screen.getByRole('button', { name: /action_cant_identify_one/ })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /open_photo/ }));
        expect(actions.onOpenPhoto).toHaveBeenCalledWith(expect.objectContaining({ Id: 2 }));
    });

    it('shrinks a tagged block to one line with Undo', () => {
        const onUndo = vi.fn();
        const c = cand(1, 'Wedding', '1926');
        render(
            <MobileFacesQueue items={[{ settled: { key: 's', name: 'Ada', candidates: [c] as never, outcome: { kind: 'tagged', person: 'Ada Example' }, index: 0 } }]}
                groups={[]} pendingTotal={0} resolvedView={false} onView={vi.fn()} loading={false} error={null}
                actions={actions} confirmAllCount={0} bulkBusy={false} onConfirmAll={vi.fn()} onUndo={onUndo} />,
        );
        const line = screen.getByTestId('face-block-settled');
        expect(line).toHaveTextContent('settled_tagged');
        fireEvent.click(within(line).getByRole('button', { name: 'action_undo' }));
        expect(onUndo).toHaveBeenCalledWith([1]);
    });
});
