import type { FactKind } from '@/lib/research/fact-query';
import { defineSite } from '@/lib/research/site';

const BIRTH_FROM_PERSON: FactKind[] = ['death', 'burial', 'census', 'residence', 'immigration', 'other'];

export default defineSite({
    id: 'familysearch',
    name: 'FamilySearch',
    repository: { name: 'FamilySearch', website: 'https://www.familysearch.org' },
    factKinds: ['name', 'birth', 'census', 'residence', 'marriage', 'immigration', 'death', 'burial', 'other'],
    regions: null,
    status: 'documented',
    verified: '2026-10-04',
    docs: 'https://developers.familysearch.org/main/docs/query-terms',
    requires: ['name'],
    search: {
        url: 'https://www.familysearch.org/en/search/record/results',
        params: [
            { param: 'q.givenName', value: 'given' },
            { param: 'q.surname', value: 'surname' },
            { param: 'q.sex', value: 'sex', map: { F: 'Female', M: 'Male' } },
            { param: 'q.birthLikeDate.from', value: 'event.yearFrom', kinds: ['name', 'birth'] },
            { param: 'q.birthLikeDate.to', value: 'event.yearTo', kinds: ['name', 'birth'] },
            { param: 'q.birthLikePlace', value: 'event.place', kinds: ['name', 'birth'] },
            { param: 'q.marriageLikeDate.from', value: 'event.yearFrom', kinds: ['marriage'] },
            { param: 'q.marriageLikeDate.to', value: 'event.yearTo', kinds: ['marriage'] },
            { param: 'q.marriageLikePlace', value: 'event.place', kinds: ['marriage'] },
            { param: 'q.deathLikeDate.from', value: 'event.yearFrom', kinds: ['death', 'burial'] },
            { param: 'q.deathLikeDate.to', value: 'event.yearTo', kinds: ['death', 'burial'] },
            { param: 'q.deathLikePlace', value: 'event.place', kinds: ['death', 'burial'] },
            { param: 'q.residenceDate.from', value: 'event.yearFrom', kinds: ['census', 'residence'] },
            { param: 'q.residenceDate.to', value: 'event.yearTo', kinds: ['census', 'residence'] },
            { param: 'q.residencePlace', value: 'event.place', kinds: ['census', 'residence'] },
            { param: 'q.anyDate.from', value: 'event.yearFrom', kinds: ['immigration', 'other'] },
            { param: 'q.anyDate.to', value: 'event.yearTo', kinds: ['immigration', 'other'] },
            { param: 'q.anyPlace', value: 'event.place', kinds: ['immigration', 'other'] },
            // Every other fact narrows by the person's own birth years.
            { param: 'q.birthLikeDate.from', value: 'birth.yearFrom', kinds: BIRTH_FROM_PERSON },
            { param: 'q.birthLikeDate.to', value: 'birth.yearTo', kinds: BIRTH_FROM_PERSON },
            { param: 'q.spouseGivenName', value: 'spouse.given' },
            { param: 'q.spouseSurname', value: 'spouse.surname' },
        ],
    },
});
