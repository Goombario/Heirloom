import { defineSite } from '@/lib/research/site';
import type { Transform } from '@/lib/research/transforms';

/** Find a Grave's year filter: exact ±1, 3, 5, 10 or 25 years. */
const YEAR_FILTER: Transform = { name: 'roundToSteps', steps: [1, 3, 5, 10, 25] };

export default defineSite({
    id: 'findagrave',
    name: 'Find a Grave',
    repository: { name: 'Find a Grave', website: 'https://www.findagrave.com' },
    factKinds: ['death', 'burial'],
    regions: null,
    status: 'observed',
    verified: '2026-10-04',
    docs: 'https://www.findagrave.com/memorial/search',
    requires: ['surname'],
    search: {
        url: 'https://www.findagrave.com/memorial/search',
        params: [
            { param: 'firstname', value: 'givenFirst' },
            { param: 'middlename', value: 'givenMiddle' },
            { param: 'lastname', value: 'surname' },
            { param: 'birthyear', value: 'birth.yearMid' },
            { param: 'birthyearfilter', value: 'birth.yearHalfSpan', transform: YEAR_FILTER },
            { param: 'deathyear', value: 'event.yearMid' },
            { param: 'deathyearfilter', value: 'event.yearHalfSpan', transform: YEAR_FILTER },
            { param: 'location', value: 'event.place' },
        ],
    },
});
