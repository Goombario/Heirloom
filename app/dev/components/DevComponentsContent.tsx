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
    DetailBody,
    DetailRail,
    IconTile,
    LeadText,
    OpenInTreeRow,
    PageShell,
    RecordMenu,
    SectionHeader,
    SegmentedControl,
    type RecordMenuItem,
} from '@/app/components/ui';
import { useTheme } from '@/app/components/ThemeProvider';
import { Pencil, Trash2, Users, UserRound, FolderSearch } from '@/lib/icons';

type Role = 'editor' | 'contributor' | 'viewer';

const BIO = 'Anna grew up on the Österby ironworks, where her father was a smith. She went into service in Uppsala at fourteen and wrote home every month. In 1891 she sailed from Göteborg to join her brother in Duluth, where she kept a boarding house on Superior Street for thirty years. Her letters, kept by her niece until 1974, are the main source for the family\'s years in Minnesota.';
const SHORT_BIO = 'Anna kept a boarding house in Duluth for thirty years.';

const noop = () => {};

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
