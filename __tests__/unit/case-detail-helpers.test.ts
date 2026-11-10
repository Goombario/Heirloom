import { describe, it, expect } from 'vitest';
import { toPersonResults } from '@/app/cases/view/case-detail-helpers';
import type { CaseWithRelations } from '@/lib/db/schema';

describe('toPersonResults', () => {
    it('maps case people to PersonResult with null birth/death dates', () => {
        const people: CaseWithRelations['people'] = [
            { Id: 7, FirstName: 'Giovanni', LastName: 'Russo', Sex: 'M', PrimaryMediaId: 3, FocalX: 40, FocalY: 60, FocalRadius: 12 },
        ];
        expect(toPersonResults(people)).toEqual([
            { Id: 7, FirstName: 'Giovanni', LastName: 'Russo', Sex: 'M', BirthDate: null, DeathDate: null, PrimaryMediaId: 3, FocalX: 40, FocalY: 60, FocalRadius: 12 },
        ]);
    });

    it('coerces missing Sex and FocalRadius to null', () => {
        const people = [
            { Id: 8, FirstName: 'Maria', LastName: null, Sex: null as string | null },
        ] as CaseWithRelations['people'];
        const [r] = toPersonResults(people);
        expect(r.Sex).toBeNull();
        expect(r.FocalRadius).toBeNull();
        expect(r.BirthDate).toBeNull();
    });
});
