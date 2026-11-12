'use client';

/**
 * The /dev/components gallery (#55). Every prop here is a made-up fixture: nothing
 * calls `@/lib/data` on render, so the page needs no database or seeded tree.
 * Strings are dev-only labels, never shown in a production build.
 */

import { useState } from 'react';
import {
    ActionLink,
    Button,
    Card,
    CoverBand,
    DataTable,
    FieldColumn,
    FieldColumns,
    FilterChip,
    FormBlock,
    FormDialog,
    ListToolbar,
    RecordBlock,
    TablePanel,
    WarningLine,
    type Column,
    DetailBody,
    DetailRail,
    EmptySlot,
    FamilyRecordRow,
    IconTile,
    InlinePanel,
    Input,
    LeadText,
    OpenInTreeRow,
    PageShell,
    ParentRelationshipSelects,
    PersonFinder,
    PersonIdentity,
    PersonRow,
    RecordMenu,
    SectionHeader,
    SegmentedControl,
    SuggestionRow,
    type RecordMenuItem,
} from '@/app/components/ui';
import { useTheme } from '@/app/components/ThemeProvider';
import { Timeline } from '@/app/components/Timeline';
import type { PersonResult } from '@/lib/db/schema';
import type { ChildRelationships } from '@/lib/child-relationship';
import { Heart, Sprout, Pencil, Plus, Trash2, Users, UserRound, FolderSearch } from '@/lib/icons';

type Role = 'editor' | 'contributor' | 'viewer';

const BIO = 'Anna grew up on the Österby ironworks, where her father was a smith. She went into service in Uppsala at fourteen and wrote home every month. In 1891 she sailed from Göteborg to join her brother in Duluth, where she kept a boarding house on Superior Street for thirty years. Her letters, kept by her niece until 1974, are the main source for the family\'s years in Minnesota.';
const SHORT_BIO = 'Anna kept a boarding house in Duluth for thirty years.';

const noop = () => {};

/** Finder fixtures: the dev page never touches the tree. */
const FIXTURE_PEOPLE: PersonResult[] = [
    { Id: 901, FirstName: 'Maja', LastName: 'Berg', Sex: 'F', BirthDate: '1893', DeathDate: '1977' },
    { Id: 902, FirstName: 'Nils', LastName: 'Berg', Sex: 'M', BirthDate: '1895', DeathDate: '1902' },
    { Id: 903, FirstName: 'Greta', LastName: 'Holm', Sex: 'F', BirthDate: '1871', DeathDate: null },
    { Id: 904, FirstName: 'Erik', LastName: 'Lindqvist', Sex: 'M', BirthDate: '1866', DeathDate: '1931' },
];
const fixtureSearch = async (q: string) => {
    await new Promise((r) => setTimeout(r, 200));
    const needle = q.toLowerCase();
    return FIXTURE_PEOPLE.filter((p) => `${p.FirstName} ${p.LastName}`.toLowerCase().includes(needle));
};

interface FixtureRow { id: number; name: string; years: string; place: string }
const FIXTURE_ROWS: FixtureRow[] = Array.from({ length: 31 }, (_, i) => ({
    id: i + 1,
    name: ['Anna Lindqvist', 'Johan Lindqvist', 'Kristina Holm', 'Maja Berg', 'Nils Berg', 'Greta Holm', 'Erik Lindqvist'][i % 7],
    years: `${1840 + i}–${1900 + i}`,
    place: ['Österbybruk', 'Uppsala', 'Duluth', 'Göteborg'][i % 4],
}));

function DialogListBoards({ canWrite }: { canWrite: boolean }) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState('living');
    const [first, setFirst] = useState('');
    const [parentRel, setParentRel] = useState<ChildRelationships>({ partner1: 'Birth', partner2: 'Birth' });
    const [q, setQ] = useState('');
    const [chip, setChip] = useState<'all' | 'living' | 'unsourced'>('all');
    const [page, setPage] = useState(1);
    const rows = FIXTURE_ROWS.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
    const cols: Column<FixtureRow>[] = [
        { key: 'name', header: 'Name', sortable: true, render: (r) => <span className="serif font-semibold">{r.name}</span> },
        { key: 'years', header: 'Years', render: (r) => <span className="date-mono">{r.years}</span> },
        { key: 'place', header: 'Born in', render: (r) => r.place },
    ];
    return (
        <>
            <Board title="FormDialog and form parts" note="640px over the page. Sections are eyebrows and space, no cards. Died greys out while Living. Partners and parents are tinted blocks with × after the name. Warnings are orange (C11). Close asks first once something is typed.">
                <Button variant="outline" onClick={() => setOpen(true)}>Open Add a person</Button>
                <FormDialog
                    open={open}
                    onClose={() => { setOpen(false); setFirst(''); }}
                    title="Add a person"
                    dirty={first.length > 0}
                    footerStart={<Button variant="ghost" onClick={() => setOpen(false)}>Save and add another</Button>}
                    footer={(close) => (
                        <>
                            <Button variant="outline" onClick={close}>Cancel</Button>
                            <Button variant="primary" onClick={() => setOpen(false)}>Save and open</Button>
                        </>
                    )}
                >
                    <FormBlock title="Name">
                        <FieldColumns>
                            <Input size="sm" label="First name" value={first} onChange={(e) => setFirst(e.target.value)} />
                            <Input size="sm" label="Last name" />
                        </FieldColumns>
                        <WarningLine action={<ActionLink kind="leave" href="/people/view?id=1">Open</ActionLink>}>Anna Berg, born 1893, may already be in this tree.</WarningLine>
                    </FormBlock>
                    <FormBlock title="Status">
                        <SegmentedControl aria-label="Status" value={status} onChange={setStatus}
                            options={[{ v: 'living', l: 'Living' }, { v: 'deceased', l: 'Deceased' }, { v: 'unknown', l: 'Unknown' }]} />
                    </FormBlock>
                    <div className="pt-5">
                        <FieldColumns>
                            <FieldColumn title="Born" action={<ActionLink onClick={noop} kind="action">Cite</ActionLink>}>
                                <Input size="sm" label="Date" />
                                <Input size="sm" label="Place" />
                            </FieldColumn>
                            <FieldColumn title="Died" inactive={status === 'living'} inactiveReason="Living people have no death." action={<ActionLink onClick={noop} kind="action">Cite</ActionLink>}>
                                <Input size="sm" label="Date" />
                                <Input size="sm" label="Place" />
                            </FieldColumn>
                        </FieldColumns>
                    </div>
                    <FormBlock title="Parents" action={<ActionLink onClick={noop} kind="action">Find their parents</ActionLink>}>
                        <RecordBlock
                            identity={<PersonIdentity as="span" name="Johan Lindqvist" initials="JL" sex="M" lifespan={<span className="date-mono">1838–1904</span>} />}
                            onRemove={canWrite ? noop : undefined}
                            removeLabel="Remove Johan Lindqvist"
                        >
                            <ParentRelationshipSelects value={parentRel} onChange={setParentRel} partner1Name="Johan" partner2Name="Kristina" />
                        </RecordBlock>
                    </FormBlock>
                </FormDialog>
            </Board>

            <Board title="List recipe: ListToolbar and TablePanel" note="Search (press /), chips with counts, the one copper button on the right (C5), then one white panel with the table and the pager in its footer. Selected chips are navy in light mode (C6).">
                <div className="grid gap-3">
                    <ListToolbar
                        search={q}
                        onSearchChange={(v) => { setQ(v); setPage(1); }}
                        searchLabel="Search people"
                        filters={<>
                            <FilterChip active={chip === 'all'} count={412} onClick={() => setChip('all')}>All</FilterChip>
                            <FilterChip active={chip === 'living'} count={38} onClick={() => setChip('living')}>Living</FilterChip>
                            <FilterChip active={chip === 'unsourced'} count={97} onClick={() => setChip('unsourced')}>No sources</FilterChip>
                        </>}
                        action={canWrite ? <Button variant="primary" icon={<Plus className="w-4 h-4" aria-hidden="true" />}>Add person</Button> : undefined}
                    />
                    <TablePanel page={page} pageSize={10} total={rows.length} onPage={setPage}>
                        <DataTable columns={cols} rows={rows.slice((page - 1) * 10, page * 10)} rowKey={(r) => r.id} />
                    </TablePanel>
                </div>
            </Board>
        </>
    );
}

function OverlayBoards({ canWrite }: { canWrite: boolean }) {
    const [picked, setPicked] = useState<string>('nobody yet');
    const [panelOpen, setPanelOpen] = useState(false);
    const [place, setPlace] = useState('Österbybruk');
    const [rel, setRel] = useState<ChildRelationships>({ partner1: 'Birth', partner2: 'Step' });
    const [solo, setSolo] = useState<ChildRelationships>({ partner1: 'Birth', partner2: 'Birth' });
    return (
        <>
            <Board title="PersonFinder · single" note="A popover under its link, over the page. Create first once you type; suggestions with reasons before you type. Try “berg”. ↑/↓, Enter, Escape.">
                <div className="flex flex-wrap items-start gap-6">
                    <PersonFinder
                        title="Find a partner"
                        treeId={null}
                        search={fixtureSearch}
                        suggestions={[{ person: FIXTURE_PEOPLE[2], reason: 'Godparent at Anna’s baptism' }]}
                        onCreate={(name) => setPicked(`new person “${name}”`)}
                        onPick={(p) => setPicked(`${p.FirstName} ${p.LastName}`)}
                        trigger={(tp) => <ActionLink kind="action" {...tp}>Find a partner</ActionLink>}
                    />
                    <span className="text-meta text-text-muted">Picked: {picked}</span>
                </div>
            </Board>

            <Board title="PersonFinder · multiple" note="Add children: rows take checkboxes and the footer adds them all.">
                <PersonFinder
                    multiple
                    title="Add children"
                    treeId={null}
                    search={fixtureSearch}
                    excludeIds={[904]}
                    suggestions={FIXTURE_PEOPLE.slice(0, 2).map((person) => ({ person, reason: 'Same last name; born after the marriage' }))}
                    onPickMany={(ps) => setPicked(ps.map((p) => p.FirstName).join(', '))}
                    addManyLabel={(n) => (n === 1 ? 'Add 1 child' : `Add ${n} children`)}
                    trigger={(tp) => <EmptySlot {...tp} title="Add children" hint="Find people already in the tree" />}
                />
            </Board>

            <Board title="InlinePanel" note="Opens in place under its row and focuses its first field. Escape asks before dropping changes. Delete is red text on the left, editors only.">
                <div className="max-w-[640px]">
                    {panelOpen ? (
                        <InlinePanel
                            label="Edit Birth"
                            dirty={place !== 'Österbybruk'}
                            saving={false}
                            onSave={() => setPanelOpen(false)}
                            onCancel={() => { setPlace('Österbybruk'); setPanelOpen(false); }}
                            onDelete={canWrite ? () => setPanelOpen(false) : undefined}
                            deleteLabel="Delete event"
                        >
                            <Input size="sm" label="Place" value={place} onChange={(e) => setPlace(e.target.value)} />
                        </InlinePanel>
                    ) : (
                        <Button size="sm" variant="outline" onClick={() => setPanelOpen(true)}>Edit Birth</Button>
                    )}
                </div>
            </Board>

            <Board title="ParentRelationshipSelects" note="One select per partner (ADR 0027); with one partner, one select sets both.">
                <div className="grid gap-4 max-w-[640px]">
                    <ParentRelationshipSelects value={rel} onChange={setRel} partner1Name="Johan" partner2Name="Kristina" />
                    <ParentRelationshipSelects value={solo} onChange={setSolo} partner1Name="Johan" />
                </div>
            </Board>
        </>
    );
}

function personMenu(role: Role): RecordMenuItem[] {
    if (role === 'viewer') return [];
    const items: RecordMenuItem[] = [
        { label: 'Edit person', icon: <Pencil className="w-4 h-4" aria-hidden="true" />, onSelect: noop },
        { label: 'Descendants', icon: <Users className="w-4 h-4" aria-hidden="true" />, onSelect: noop },
    ];
    if (role === 'editor') items.push({ label: 'Delete person', icon: <Trash2 className="w-4 h-4" aria-hidden="true" />, danger: true, separated: true, onSelect: noop });
    return items;
}

const placeMenu: RecordMenuItem[] = [
    { label: 'Rename or merge', onSelect: noop },
    { label: 'Move records to another place', onSelect: noop },
    { label: 'Delete place', danger: true, separated: true, disabled: true, disabledReason: 'Only when no records use it. 112 do.', onSelect: noop },
];

function Portrait({ initials }: { initials?: string }) {
    // A stand-in for the person's photo: a warm sepia field with initials.
    return (
        <div className="w-full h-full grid place-items-center serif text-3xl font-semibold bg-card-alt text-text-muted" aria-hidden="true">
            {initials ?? ''}
        </div>
    );
}

function Board({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
    return (
        <section className="grid gap-4 py-8 border-t border-border" aria-label={title}>
            <div>
                <h2 className="section m-0">{title}</h2>
                {note && <p className="m-0 mt-1 text-sm text-text-secondary max-w-[68ch]">{note}</p>}
            </div>
            {children}
        </section>
    );
}

function Placeholder({ lines = 3 }: { lines?: number }) {
    return (
        <div className="grid gap-2" aria-hidden="true">
            {Array.from({ length: lines }, (_, i) => <div key={i} className={i % 2 === 1 ? 'h-2 rounded-full bg-surface-2 w-3/5' : 'h-2 rounded-full bg-surface-2'} />)}
        </div>
    );
}

function MainSection({ id, title, count, action }: { id: string; title: string; count?: number; action?: React.ReactNode }) {
    return (
        <section id={id} aria-labelledby={`${id}-h`} tabIndex={-1}>
            <SectionHeader headingId={`${id}-h`} title={title} count={count} action={action} />
            <Placeholder />
        </section>
    );
}

export default function DevComponentsContent() {
    const [role, setRole] = useState<Role>('editor');
    const { resolvedTheme, setTheme } = useTheme();
    const editor = role === 'editor';
    const canWrite = role !== 'viewer';

    return (
        <PageShell variant="detail">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-2">
                <div>
                    <div className="eyebrow">Dev only · #55</div>
                    <p className="title m-0">Desktop components</p>
                </div>
                <div className="flex flex-wrap gap-3">
                    <SegmentedControl
                        aria-label="Role"
                        value={role}
                        onChange={(v) => setRole(v as Role)}
                        options={[{ v: 'editor', l: 'Editor' }, { v: 'contributor', l: 'Contributor' }, { v: 'viewer', l: 'Viewer' }]}
                    />
                    <SegmentedControl
                        aria-label="Theme"
                        value={resolvedTheme}
                        onChange={(v) => setTheme(v as 'light' | 'dark')}
                        options={[{ v: 'light', l: 'Light' }, { v: 'dark', l: 'Dark' }]}
                    />
                </div>
            </div>

            <Board title="CoverBand · cover with portrait" note="Person page: 144px band, hanging 4:3 portrait, lead text beside it, ⋯ in the actions slot (hidden for viewers). Read all doesn't move the portrait.">
                <CoverBand
                    eyebrow="Person"
                    title="Anna Lindqvist"
                    titleSize="hero"
                    meta={<><span className="date-mono">1868–1941</span> · Österbybruk, Uppsala</>}
                    actions={<RecordMenu tone="island" recordName="Anna Lindqvist" items={personMenu(role)} />}
                    portrait={<Portrait initials="AL" />}
                    lead={<LeadText onEdit={canWrite ? noop : undefined} editLabel="Edit biography">{BIO}</LeadText>}
                />
            </Board>

            <Board title="CoverBand · cover, short lead" note="When the text fits in three lines there is no Read all.">
                <CoverBand
                    eyebrow="Marriage"
                    title="Johan Lindqvist & Kristina Holm"
                    meta={<><span className="date-mono">1862</span> · Österbybruk</>}
                    actions={<RecordMenu tone="island" recordName="Johan Lindqvist & Kristina Holm" items={role === 'viewer' ? [] : [{ label: 'Edit family', onSelect: noop }, ...(editor ? [{ label: 'Delete family', danger: true, separated: true, onSelect: noop }] : [])]} />}
                    portrait={<Portrait initials="J K" />}
                    lead={<LeadText onEdit={canWrite ? noop : undefined} editLabel="Edit note">{SHORT_BIO}</LeadText>}
                />
            </Board>

            <Board title="CoverBand · cover, no portrait (Home)" note="No ⋯ and no buttons: the actions slot stays empty.">
                <CoverBand
                    eyebrow="Your tree"
                    title="Lindqvist family"
                    meta={<>412 people · 96 families · <span className="date-mono">1702–2019</span></>}
                />
            </Board>

            <Board title="CoverBand · actions slot (Research case)" note="C1: the case actions sit in the band beside the title.">
                <CoverBand
                    variant="short"
                    eyebrow="Research case"
                    title="Where did Anna live before 1891?"
                    titleSize="record"
                    meta="In progress · opened 3 Oct 2026 · 3 leads"
                    actions={canWrite ? (
                        <>
                            <Button variant="primary">Answer and close</Button>
                            <RecordMenu tone="island" recordName="Where did Anna live before 1891?" items={[{ label: 'Edit the question', onSelect: noop }, { label: 'Copy link', onSelect: noop }, ...(editor ? [{ label: 'Delete the case', danger: true, separated: true, onSelect: noop }] : [])]} />
                        </>
                    ) : undefined}
                />
            </Board>

            <Board title="CoverBand · short (lists and Tools)" note="Eyebrow, page title, counts line. Same gradient as the cover (C2).">
                <CoverBand variant="short" eyebrow="Lindqvist family" title="People" meta="412 people" />
                <CoverBand variant="short" eyebrow="Tools" title="Import and export" meta="Lindqvist family · 412 people · 96 families" />
            </Board>

            <Board title="CoverBand · flat (place with no pin)" note="Flat navy, no gradient. ⋯ with a disabled item and its reason.">
                <CoverBand
                    variant="flat"
                    eyebrow="Place"
                    title="Hälleforsnäs bruk"
                    meta="Not inside a larger place yet · Not on the map yet"
                    actions={canWrite ? <RecordMenu tone="island" recordName="Hälleforsnäs bruk" items={placeMenu} /> : undefined}
                />
            </Board>

            <Board title="ActionLink" note="› acts on this page, ↗ leaves it, ⌄ expands in place.">
                <div className="flex flex-wrap gap-6 items-center">
                    <ActionLink kind="action" onClick={noop}>Cite a source</ActionLink>
                    <ActionLink href="/audit">Full history</ActionLink>
                    <ActionLink kind="expand" expanded={false} onClick={noop}>Attach media</ActionLink>
                    <ActionLink kind="expand" expanded onClick={noop}>Show less</ActionLink>
                    <ActionLink onClick={noop}>Edit note</ActionLink>
                </div>
            </Board>

            <Board title="RecordMenu on a white surface" note="Surface tone, and the hover-reveal variant used by journal entries.">
                <div className="flex flex-wrap gap-6 items-center">
                    <RecordMenu recordName="Lead: Uppsala parish" items={canWrite ? [{ label: 'Edit the lead', onSelect: noop }, { label: 'Settle lead', disabled: true, disabledReason: '2 findings are undecided', onSelect: noop }, ...(editor ? [{ label: 'Drop the lead', danger: true, separated: true, onSelect: noop }] : [])] : []} />
                    <Card pad={false} className="flex items-center gap-3 px-3 py-2">
                        <span className="text-sm">Hover this journal entry</span>
                        <RecordMenu reveal="hover" recordName="Journal note" items={canWrite ? [{ label: 'Strike out', onSelect: noop }] : []} />
                    </Card>
                    {role === 'viewer' && <span className="text-sm text-text-muted">Viewers get no ⋯ at all.</span>}
                </div>
            </Board>

            <Board title="OpenInTreeRow and IconTile" note="C7: 'Starts from'. C8: outlined tile instead of the grey fill.">
                <div className="grid gap-4 md:grid-cols-2">
                    <OpenInTreeRow personId={1} firstName="Anna" />
                    <OpenInTreeRow personId={2} firstName="Bartholomew-Alexander" />
                </div>
                <div className="flex flex-wrap gap-3 items-center">
                    <IconTile size={32}><UserRound className="w-4 h-4" /></IconTile>
                    <IconTile><Users className="w-[18px] h-[18px]" /></IconTile>
                    <IconTile size={40}><FolderSearch className="w-5 h-5" /></IconTile>
                </div>
            </Board>

            <Board title="PersonRow" note="PersonIdentity in a link, role tag after the years, hover Edit and unlink beside the link (never inside it). Serif names on v1.1 rows (C9). Contributors get Edit only; viewers get neither.">
                <div className="grid gap-1 max-w-[420px]">
                    {[
                        { id: 11, name: 'Erik Berg', sex: 'M', years: '1864–1930', role: null },
                        { id: 12, name: 'Maja Berg', sex: 'F', years: '1893–1977', role: 'foster child' },
                        { id: 13, name: 'Nils Berg', sex: 'M', years: '1895–1902', role: 'stepson' },
                        { id: 14, name: 'Bartholomew-Alexander Lindqvist-Holmström', sex: 'X', years: '1901–', role: 'half-sibling' },
                    ].map((p) => (
                        <PersonRow
                            key={p.id}
                            href={`/people/view?id=${p.id}`}
                            name={p.name}
                            initials={p.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                            sex={p.sex}
                            nameStyle="serif"
                            lifespan={<span className="date-mono">{p.years}</span>}
                            role={p.role}
                            edit={canWrite ? { label: `Edit ${p.name}`, onClick: noop } : undefined}
                            unlink={editor ? { label: `Remove ${p.name} from this family`, onClick: noop } : undefined}
                        />
                    ))}
                </div>
            </Board>

            <Board title="FamilyRecordRow" note="The phone's B2 row, shared. Desktop rail: no ↗, hover unlink for editors. Long names wrap (#48).">
                <div className="grid gap-3 md:grid-cols-2">
                    <FamilyRecordRow
                        density="desktop"
                        arrow={false}
                        href="/families/view?id=100"
                        title="Johan & Kristina’s family"
                        sub="Marriage · 1862 · 5 children"
                        treeId={null}
                        stack={[{ Id: 1, FirstName: 'Johan', LastName: 'Lindqvist', Sex: 'M' }, { Id: 2, FirstName: 'Kristina', LastName: 'Holm', Sex: 'F' }, { Id: 3, FirstName: 'Anna', LastName: 'Lindqvist', Sex: 'F' }]}
                        unlink={editor ? { label: 'Remove Anna from this family', onClick: noop } : undefined}
                    />
                    <FamilyRecordRow
                        density="desktop"
                        arrow={false}
                        href="/families/view?id=101"
                        title="with Carl-Gustaf Wilhelmsson Lindqvist-Holmström"
                        sub="Civil union · 1921"
                        treeId={null}
                        stack={[{ Id: 4, FirstName: 'Carl', LastName: 'Holmström', Sex: 'M' }]}
                        unlink={editor ? { label: 'Remove Anna from this family', onClick: noop } : undefined}
                    />
                </div>
            </Board>

            <Board title="SuggestionRow and EmptySlot" note="A suggestion acts in one click and says why. An empty slot opens its finder.">
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-1">
                        <SuggestionRow
                            onClick={noop}
                            reason="Same last name; born 7 years after the marriage"
                            identity={<PersonIdentity as="span" name="Maja Berg" initials="MB" sex="F" lifespan={<span className="date-mono">1893–1977</span>} />}
                        />
                        <SuggestionRow
                            onClick={noop}
                            reason="No parents yet; born 16 years after the marriage"
                            identity={<PersonIdentity as="span" name="Nils Berg" initials="NB" sex="M" lifespan={<span className="date-mono">1895–1902</span>} />}
                        />
                    </div>
                    <div className="grid gap-3 content-start">
                        <EmptySlot title="Partner unknown" hint="Find or add someone" onClick={noop} />
                        <EmptySlot title="Add a partner" onClick={noop} />
                    </div>
                </div>
            </Board>

            <OverlayBoards canWrite={canWrite} />
            <DialogListBoards canWrite={canWrite} />

            <Board title="Timeline: a relative's read-only row" note="A child's birth on the family page links to the child (↗) and takes no Edit or Delete.">
                <div className="max-w-[640px]">
                    <Timeline items={[
                        { key: 'm', icon: <Heart className="w-4 h-4" />, title: 'Marriage', meta: <><span className="date-mono">12 Jun 1862</span> · Österbybruk</>, actions: canWrite ? <span className="text-meta text-text-muted">(row actions)</span> : undefined },
                        { key: 'b', icon: <Sprout className="w-4 h-4" />, title: 'Birth of Anna', meta: <><span className="date-mono">3 Mar 1868</span> · Österbybruk</>, href: '/people/view?id=1' },
                    ]} />
                </div>
            </Board>

            <Board title="DetailBody with section index and open rail" note="Index from 1180px; rail beside the main column from 768px; sections spaced, no bars (C4). Resize to check 768–1023.">
                <DetailBody
                    divided
                    index={[
                        { id: 'dev-life', label: 'Life events' },
                        { id: 'dev-media', label: 'Media' },
                        { id: 'dev-names', label: 'Names' },
                        { id: 'dev-notes', label: 'Notes' },
                        { id: 'dev-sources', label: 'Sources' },
                    ]}
                    rail={(
                        <DetailRail look="open">
                            <OpenInTreeRow personId={1} firstName="Anna" />
                            <section aria-labelledby="dev-r1">
                                <SectionHeader level="rail" rule={false} headingId="dev-r1" title="Parents" />
                                <Placeholder lines={2} />
                            </section>
                            <section aria-labelledby="dev-r2">
                                <SectionHeader level="rail" rule={false} headingId="dev-r2" title="Partner and children" />
                                <Placeholder lines={3} />
                            </section>
                            <section aria-labelledby="dev-r3">
                                <SectionHeader level="rail" rule={false} headingId="dev-r3" title="Where they lived" action={<ActionLink href="/places">All places</ActionLink>} />
                                <Placeholder lines={2} />
                            </section>
                        </DetailRail>
                    )}
                >
                    <MainSection id="dev-life" title="Life events" count={9} />
                    <MainSection id="dev-media" title="Media" count={4} action={canWrite ? <ActionLink onClick={noop}>Add media</ActionLink> : undefined} />
                    <MainSection id="dev-names" title="Names" />
                    <MainSection id="dev-notes" title="Notes" />
                    <MainSection id="dev-sources" title="Sources cited" count={6} />
                </DetailBody>
            </Board>
        </PageShell>
    );
}
