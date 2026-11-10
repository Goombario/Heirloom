/**
 * The new family-event editor must receive the same already-loaded people as
 * existing family-event editors. This keeps the media picker ranking stable
 * without issuing a second people query.
 */
/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const h = vi.hoisted(() => ({
    fetchFamily: vi.fn(),
    familyState: null as unknown,
}));

const person = (id: number) => ({
    Id: id,
    UserId: 1,
    TreeId: 99,
    FirstName: `Person ${id}`,
    LastName: 'Test',
    GivenName: null,
    Surname: null,
    NamePrefix: null,
    NameSuffix: null,
    Nickname: null,
    Sex: null,
    BirthDate: null,
    BirthPlace: null,
    DeathDate: null,
    DeathPlace: null,
    DeathCause: null,
    IsDeceased: 0,
});

h.familyState = {
    familyId: '22',
    details: {
        family: { Id: 22, Partner1Id: 1, Partner2Id: 2, MarriageDate: null, MarriagePlace: null, Type: 'Married' },
        husband: person(1),
        wife: person(2),
        children: [person(3)],
        events: [],
    },
    summary: null,
    error: null,
    phase: 'ready',
    partner1Families: null,
    partner2Families: null,
    citationMap: {},
    showInlineEvent: true,
    setShowInlineEvent: vi.fn(),
    attachTarget: null,
    setAttachTarget: vi.fn(),
    citationPreview: null,
    setCitationPreview: vi.fn(),
    placeCoords: {},
    isOpen: vi.fn(() => false),
    toggle: vi.fn(),
    fetchFamily: h.fetchFamily,
    activeTreeId: 99,
    activePermission: 'edit',
};

vi.mock('@/app/families/view/useFamilyDetail', () => ({ useFamilyDetail: () => h.familyState }));
vi.mock('@/app/components/InlineEventEditor', () => ({
    default: (props: { relevantPersonIds?: readonly number[] }) => (
        <div data-testid="new-family-event-editor" data-relevant={props.relevantPersonIds?.join(',') ?? ''} />
    ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }) }));
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ reportError: vi.fn() }) }));
vi.mock('@/app/components/SourcesCitedCard', () => ({ default: () => <div /> }));
vi.mock('@/app/components/notes/OwnerNotesCard', () => ({ OwnerNotesCard: () => <div />, NoteCount: () => null }));
vi.mock('@/app/components/media/OwnerMediaCard', () => ({ OwnerMediaCard: () => <div /> }));
vi.mock('@/app/components/AttachSourceSidebar', () => ({ default: () => <div /> }));
vi.mock('@/app/components/ConfirmDialog', () => ({ default: () => <div /> }));
vi.mock('@/app/components/ui', () => ({
    Button: (props: Record<string, unknown>) => <button {...props} />,
    DatesToCheckFlag: () => null,
    AddRow: ({ label }: { label: string }) => <button>{label}</button>,
    PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DetailHero: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    HeroEditButton: (props: Record<string, unknown>) => <button {...props} />,
    DetailRail: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DetailSection: ({ title, children }: { title: string; children: React.ReactNode }) => <section>{title}{children}</section>,
    SectionHeader: ({ title, action }: { title: string; action?: React.ReactNode }) => <div>{title}{action}</div>,
}));
vi.mock('@/app/components/data-checks/marks', () => ({ useDataCheckMarks: () => ({ open: [], byFact: new Map(), text: {} }) }));
vi.mock('@/app/families/view/FamilySummaryView', () => ({ FamilySummaryView: () => <div /> }));
vi.mock('@/app/families/view/FamilyHeroContent', () => ({ FamilyHeroContent: () => <div /> }));
vi.mock('@/app/families/view/FamilyHeroEditor', () => ({ FamilyHeroEditor: () => <div /> }));
vi.mock('@/app/families/view/sections', () => ({
    PartnerCard: () => <div />,
    // The Add event row and its panel are the timeline's footer (#760).
    FamilyTimeline: ({ footer }: { footer?: React.ReactNode }) => <div>{footer}</div>,
    ChildrenList: () => <div />,
    OtherPartnerships: () => <div />,
}));

import FamilyDetailsClient from '@/app/families/view/FamilyDetailView';

describe('FamilyDetailsClient — new event media picker context', () => {
    it('passes partners and children to a new family-event editor', () => {
        render(<FamilyDetailsClient />);
        expect(screen.getByTestId('new-family-event-editor')).toHaveAttribute('data-relevant', '1,2,3');
    });
});
