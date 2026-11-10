'use client';

/**
 * Static-fixture rendering of the inline edit-mode components — see page.tsx
 * for why this route exists. Every prop below is a hand-built fixture; NOTHING
 * here calls `@/lib/data` or any data client at render time (the components
 * themselves only reach for the client on interaction, e.g. a debounced search
 * or a save click — never on mount), so this renders with zero DB/seed
 * dependency for the a11y contrast scan.
 */

import type { Family, Person, PersonWithRelations } from '@/lib/db/schema';
import { HeroIdentityEditor } from '@/app/people/view/HeroIdentityEditor';
import { NamesPanel, type NameVariant } from '@/app/components/person-form/NamesPanel';
import { RelationshipList } from '@/app/components/person-form/RelationshipList';
import { RelationshipAddPanel } from '@/app/people/view/RelationshipAddPanel';
import { FamilyHeroEditor } from '@/app/families/view/FamilyHeroEditor';
import InlineMarriageEditor from '@/app/families/view/InlineMarriageEditor';
import { ChildrenList } from '@/app/families/view/sections';
import type { PartnerPerson } from '@/app/families/view/useFamilyDetail';
import { SearchRecordsPanel } from '@/app/components/research/SearchRecordsPanel';
import { personResearchSubject } from '@/lib/research/subject';

const noop = () => {};
const asyncNoop = async () => {};

function fixturePerson(overrides: Partial<Person>): Person {
    return {
        Id: 1,
        UserId: 1,
        TreeId: 1,
        FirstName: 'Harness',
        LastName: 'Fixture',
        Sex: 'F',
        GedcomId: null,
        BirthDate: '1950-01-01',
        BirthPlace: 'Springfield',
        DeathDate: null,
        DeathPlace: null,
        IsDeceased: 0,
        UpdatedAt: null,
        ...overrides,
    };
}

const father = fixturePerson({ Id: 2, FirstName: 'George', LastName: 'Fixture', Sex: 'M', BirthDate: '1920-01-01', DeathDate: '1990-01-01', IsDeceased: 1 });
const mother = fixturePerson({ Id: 3, FirstName: 'Martha', LastName: 'Sample', Sex: 'F', BirthDate: '1922-01-01', DeathDate: '1995-01-01', IsDeceased: 1 });
const sibling = fixturePerson({ Id: 4, FirstName: 'Sam', LastName: 'Fixture', Sex: 'M', BirthDate: '1952-01-01' });
const spouse = fixturePerson({ Id: 5, FirstName: 'Alex', LastName: 'Partner', Sex: 'M', BirthDate: '1949-01-01' });
const child = fixturePerson({ Id: 6, FirstName: 'Jamie', LastName: 'Partner', Sex: 'X', BirthDate: '1975-01-01' });

const parentsFamily: Family = {
    Id: 100, UserId: 1, TreeId: 1, Partner1Id: 2, Partner2Id: 3,
    MarriageDate: '1945-06-01', MarriagePlace: 'Springfield', Type: 'Marriage', UpdatedAt: null,
};
const spouseFamily: Family = {
    Id: 101, UserId: 1, TreeId: 1, Partner1Id: 1, Partner2Id: 5,
    MarriageDate: '1972-06-01', MarriagePlace: 'Shelbyville', Type: 'Marriage', UpdatedAt: null,
};
// A SECOND union and a SECOND parent family, so the multi-union labelling from
// #481 is inspectable here without seeded data — that grouping is exactly what
// went wrong when every block after the first had no heading of its own.
const secondSpouse = fixturePerson({ Id: 7, FirstName: 'Robin', LastName: 'Marsh', Sex: 'F', BirthDate: '1955-01-01' });
const secondSpouseFamily: Family = {
    Id: 102, UserId: 1, TreeId: 1, Partner1Id: 1, Partner2Id: 7,
    MarriageDate: '1988-04-01', MarriagePlace: 'Ogdenville', Type: 'Marriage', UpdatedAt: null,
};
const adoptiveFather = fixturePerson({ Id: 8, FirstName: 'Henry', LastName: 'Blake', Sex: 'M', BirthDate: '1918-01-01' });
const adoptiveFamily: Family = {
    Id: 103, UserId: 1, TreeId: 1, Partner1Id: 8, Partner2Id: null,
    MarriageDate: null, MarriagePlace: null, Type: 'Marriage', UpdatedAt: null,
};

const heroPerson: PersonWithRelations = {
    ...fixturePerson({}),
    EffectiveFirstName: 'Harness',
    Nickname: 'Harnie',
    parents: [
        { father, mother, family: parentsFamily, partner1Relationship: 'Birth', partner2Relationship: 'Step', siblings: [sibling] },
        { father: adoptiveFather, mother: null, family: adoptiveFamily, partner1Relationship: 'Adoption', partner2Relationship: 'Adoption', siblings: [] },
    ],
    siblings: [sibling],
    spouses: [
        { person: spouse, family: spouseFamily, children: [child] },
        { person: secondSpouse, family: secondSpouseFamily, children: [] },
    ],
};

// Family-detail fixtures. `PartnerPerson` is `Person` plus the display columns the
// family read joins on; children additionally carry their relationship to each
// partner — Jamie is Mary's stepchild, so the row's tag names her, and Robin's is
// deliberately out of the set so the type select's "Not recorded" is in the scan too.
const famPartner1: PartnerPerson = { ...fixturePerson({ Id: 2, FirstName: 'Arthur', LastName: 'Fixture', Sex: 'M', BirthDate: '1860-01-01', DeathDate: '1920-01-01', IsDeceased: 1 }), Nickname: null, EffectiveFirstName: 'Arthur' };
const famPartner2: PartnerPerson = { ...fixturePerson({ Id: 3, FirstName: 'Mary', LastName: 'Sample', Sex: 'F', BirthDate: '1865-01-01', DeathDate: '1930-01-01', IsDeceased: 1 }), Nickname: 'Molly', EffectiveFirstName: 'Mary' };
const famChildren: PartnerPerson[] = [
    { ...fixturePerson({ Id: 6, FirstName: 'Jamie', LastName: 'Fixture', Sex: 'X', BirthDate: '1890-01-01' }), Partner1Relationship: 'Birth', Partner2Relationship: 'Step' },
    { ...fixturePerson({ Id: 7, FirstName: 'Robin', LastName: 'Fixture', Sex: 'F', BirthDate: '1893-01-01' }), Partner1Relationship: 'Sealed', Partner2Relationship: 'Sealed' },
];

const nameVariants: NameVariant[] = [
    { Id: 10, PersonId: 1, Type: 'Nickname', Name: 'Harnie', FromDate: null, ToDate: null, IsPrimary: 1 },
    { Id: 11, PersonId: 1, Type: 'Maiden', Name: 'Sample', FromDate: null, ToDate: '1972-06-01', IsPrimary: 0 },
];

// Search records (#1028): a death in the USA, under a married surname, so the
// details box shows every chip and the site list has an alternate search. The
// living warning is forced on so its colour is scanned too.
const researchSubject = personResearchSubject(
    { ...mother, DeathPlace: 'Buffalo, Erie, New York, USA', spouses: [{ person: father, family: parentsFamily }] },
    [{ Type: 'Married', Name: 'Martha Fixture', FromDate: '1945-06-01' }],
    'PersonDeath',
    3,
    2026,
);

export default function A11yHarnessContent() {
    return (
        <div className="p-6 max-w-3xl mx-auto flex flex-col gap-8">
            <h1 className="text-3xl font-bold text-text">a11y harness (dev only)</h1>

            <section>
                <h2 className="text-lg font-bold text-text mb-3">HeroIdentityEditor (in .hero-dark)</h2>
                <div className="hero-flex hero-dark flex-wrap">
                    <HeroIdentityEditor
                        person={heroPerson}
                        onSave={asyncNoop}
                        onDelete={noop}
                        onCancel={noop}
                        saving={false}
                        /* Fixture, not a permission decision: delete is kept rendered so the
                           delete action stays in the contrast scan's reach. */
                        canDelete={true}
                    />
                </div>
            </section>

            <section>
                <h2 className="text-lg font-bold text-text mb-3">NamesPanel (canEdit)</h2>
                <NamesPanel
                    person={heroPerson}
                    variants={nameVariants}
                    renderCitePin={() => null}
                    canEdit
                    canDelete
                    onAdd={async () => {}}
                    onRename={async () => {}}
                    onRemove={async () => {}}
                    onSetPrimary={async () => {}}
                />
            </section>

            <section>
                <h2 className="text-lg font-bold text-text mb-3">RelationshipList (canEdit)</h2>
                <RelationshipList
                    person={heroPerson}
                    treeId={1}
                    canEdit
                    canDelete
                    onChanged={noop}
                />
            </section>

            <section>
                <h2 className="text-lg font-bold text-text mb-3">RelationshipAddPanel (partner / to-family)</h2>
                <RelationshipAddPanel
                    personId={1}
                    treeId={1}
                    excludeIds={[1]}
                    onAdded={noop}
                    onClose={noop}
                />
            </section>

            <section>
                <h2 className="text-lg font-bold text-text mb-3">FamilyHeroEditor (in .hero-dark)</h2>
                <div className="hero-dark">
                    <FamilyHeroEditor
                        partner1={famPartner1}
                        partner2={famPartner2}
                        type="Marriage"
                        marriageDate="12 JUN 1920"
                        /* null for the same reason as InlineMarriageEditor below: a saved
                           place triggers a pin-chain lookup through the data client. */
                        marriagePlace={null}
                        endEvent={{ Type: 'DIV', Date: '1931' }}
                        treeId={1}
                        saving={false}
                        /* Same fixture rationale as above — the delete action stays rendered. */
                        canDelete
                        onSave={asyncNoop}
                        onCancel={noop}
                        onDelete={noop}
                    />
                </div>
            </section>

            <section>
                <h2 className="text-lg font-bold text-text mb-3">InlineMarriageEditor</h2>
                {/* marriagePlace is null on purpose: a saved place triggers a pin-chain
                    lookup through the data client on mount, and this route must render
                    with zero data-client reach (see the file header). The editor's own
                    chrome — fields, labels, buttons — is identical either way. */}
                <InlineMarriageEditor
                    familyId={101}
                    treeId={1}
                    marriageDate="1888-06-01"
                    marriagePlace={null}
                    kindLabel="marriage"
                    canDelete={false}
                    withMedia={false}
                    onCancel={noop}
                    onSaved={noop}
                />
            </section>

            {researchSubject && (
                <section>
                    <h2 className="text-lg font-bold text-text mb-3">SearchRecordsPanel</h2>
                    <div className="max-w-sm bg-card">
                        <SearchRecordsPanel subject={{ ...researchSubject, mayBeLiving: true }} canCite />
                    </div>
                </section>
            )}

            <section>
                <h2 className="text-lg font-bold text-text mb-3">ChildrenList (canEdit)</h2>
                <ChildrenList
                    childList={famChildren}
                    partner1={famPartner1}
                    partner2={famPartner2}
                    treeId={1}
                    familyId={101}
                    canEdit
                    canDelete
                    onChanged={noop}
                />
            </section>
        </div>
    );
}
