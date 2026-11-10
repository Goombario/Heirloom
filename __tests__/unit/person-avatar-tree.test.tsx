/**
 * @vitest-environment happy-dom
 *
 * #929 — avatars that load a photo by id must name the active tree, or the
 * server looks in the default tree and a shared tree's photos 404.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({ avatars: [] as Array<{ mediaId?: number | null; treeId?: number | null }> }));
const person = {
    Id: 1, FirstName: 'Ada', LastName: 'Byron', Sex: 'F', IsDeceased: 0, PrimaryMediaId: 5,
    BirthDate: null, BirthPlace: null, DeathDate: null, DeathPlace: null,
    FatherFirstName: null, FatherLastName: null, MotherFirstName: null, MotherLastName: null,
};
const face = { id: 1, primaryMediaId: 5, firstName: 'Ada', lastName: 'Byron', sex: 'F', focalX: 50, focalY: 50, focalRadius: null };

vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 7, activePermission: 'view', currentUserId: 1 }) }));
vi.mock('@/app/components/PersonAvatar', () => ({
    default: (props: { mediaId?: number | null; treeId?: number | null }) => { h.avatars.push({ mediaId: props.mediaId, treeId: props.treeId }); return null; },
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/people',
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key, useLocale: () => 'en' }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/date-input/aliases', () => ({ useDateQualifierWords: () => ({}) }));
vi.mock('@/app/components/useCachedResource', () => ({
    useCachedResource: () => ({ data: { people: [person] }, loading: false, error: null, retry: vi.fn() }),
}));
vi.mock('@/app/components/useLoadPhase', () => ({ useLoadPhase: () => 'ready' }));
vi.mock('@/lib/data', () => ({ getDataClient: vi.fn() }));
vi.mock('@/app/people/view/personCache', () => ({ cachePersonSummaries: vi.fn(), prefetchPerson: vi.fn() }));
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ redirectIfUnauthorized: vi.fn() }) }));
vi.mock('@/app/components/SearchBar', () => ({ default: () => null }));

import PeoplePageClient from '@/app/people/PeoplePageClient';
import { FaceStack } from '@/app/places/PinMark';
import { PlaceCard } from '@/app/places/PlaceCard';

describe('avatars in a non-default tree (#929)', () => {
    it('the People list asks for every avatar photo in the active tree', () => {
        h.avatars = [];
        render(<PeoplePageClient initialPeople={null} />);
        const photos = h.avatars.filter((a) => a.mediaId === 5);
        expect(photos.length).toBeGreaterThan(0);
        expect(photos.every((a) => a.treeId === 7)).toBe(true);
    });

    it('the places map face stack uses the active tree', () => {
        h.avatars = [];
        render(<FaceStack faces={[face as never]} />);
        expect(h.avatars).toEqual([{ mediaId: 5, treeId: 7 }]);
    });

    it('the place card face stack uses the active tree', () => {
        h.avatars = [];
        render(<PlaceCard name="Dover, Kent" count={1} peopleCount={1} faces={[face as never]} />);
        expect(h.avatars).toEqual([{ mediaId: 5, treeId: 7 }]);
    });
});
