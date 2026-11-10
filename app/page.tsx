'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTree } from '@/app/contexts/TreeContext';
import { Card, Button, Badge, DetailRail, PageShell, SectionHeader, Lifespan } from '@/app/components/ui';
import { livingStatus } from '@/lib/living';
import { Plus, Upload } from '@/lib/icons';
import PersonAvatar from '@/app/components/PersonAvatar';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import { getDataClient } from '@/lib/data';
import { useCachedResource } from '@/app/components/useCachedResource';
import type { ResumedPerson } from '@/lib/data/types';
import type { AuditLogEntryWithUser } from '@/lib/db/schema';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import { useTimestamp } from '@/app/hooks/useTimestamp';
import { EntityLabelText } from '@/app/components/EntityLabelText';
import { CaseStatus } from '@/app/cases/CaseStatus';
import { DatesToCheckCard } from '@/app/components/data-checks/DatesToCheckCard';
import { MobileHome } from '@/app/components/home/MobileHome';
import { formatAction } from '@/app/components/home/formatAction';
import { placeHref } from '@/lib/places/place-key';

type Translator = ReturnType<typeof useTranslations>;

function getEntityLink(entry: AuditLogEntryWithUser): string {
    if (entry.EntityType === 'person') return `/people/view?id=${entry.EntityId}`;
    if (entry.EntityType === 'family') return `/families/view?id=${entry.EntityId}`;
    return '/audit';
}

/** Localized one-line summary for an 'import' activity entry (counts from the snapshot). */
function formatImport(entry: AuditLogEntryWithUser, t: Translator): string {
    const snap = (entry.Changes as { snapshot?: { people?: number; families?: number } } | null)?.snapshot;
    if (snap && typeof snap.people === 'number' && typeof snap.families === 'number') {
        return t('activity_import', { people: snap.people, families: snap.families });
    }
    return entry.EntityLabel || t('activity_import_generic');
}

/** Placeholder rows for the dashboard list cards while data loads. `divided` adds
 *  row padding + separators (for bare `.card` lists); without it the rows stack
 *  tightly (for `card-pad` rails). */
function HomeListSkeleton({ rows = 3, divided = true }: { rows?: number; divided?: boolean }) {
    return (
        <div aria-busy="true">
            {Array.from({ length: rows }).map((_, i) => (
                <div
                    key={i}
                    className={`flex flex-col gap-1.5 ${divided ? 'py-3 px-4' : 'py-2 px-0'} ${i < rows - 1 ? 'border-b border-b-[color:var(--border-light)]' : ''}`}
                >
                    <span className="skeleton h-[13px] rounded-[4px]" style={{ width: `${55 - i * 6}%` }} aria-hidden="true" />
                    <span className="skeleton h-[11px] rounded-[4px]" style={{ width: `${34 - i * 3}%` }} aria-hidden="true" />
                </div>
            ))}
        </div>
    );
}

/** Placeholder for the "resume" hero card (avatar + name + pills) while data loads. */
function ResumeCardSkeleton() {
    return (
        <div className="card card-pad mb-4 border-l-[3px] border-l-[color:var(--text-secondary)] py-4 px-5" aria-busy="true">
            <div className="row gap-3 mb-3">
                <span className="skeleton w-12 h-12 rounded-full shrink-0" aria-hidden="true" />
                <div className="flex-1">
                    <span className="skeleton block h-[18px] rounded-[6px] mb-2" style={{ width: '45%' }} aria-hidden="true" />
                    <span className="skeleton block h-3 rounded-[4px]" style={{ width: '28%' }} aria-hidden="true" />
                </div>
            </div>
            <div className="row gap-1.5">
                <span className="skeleton w-14 h-5 rounded-full" aria-hidden="true" />
                <span className="skeleton w-[76px] h-5 rounded-full" aria-hidden="true" />
            </div>
        </div>
    );
}

const GROUPED_TYPES = new Set(['person', 'family', 'event', 'media', 'story', 'case', 'source', 'citation', 'mediatag', 'namevariant', 'place', 'familychild', 'datacheck', 'note', 'casenote']);

/** "Added 88 citations" for a bulk run collapsed by the dashboard (#768, DV-3). */
function formatGroup(entry: { Action: string; EntityType: string; GroupCount: number; GroupCountAtLeast: boolean }, t: Translator): string {
    const noun = GROUPED_TYPES.has(entry.EntityType) ? entry.EntityType : 'other';
    const items = t(`activity_items_${noun}`, { count: entry.GroupCount, plus: entry.GroupCountAtLeast ? '+' : '' });
    const verb = entry.Action === 'create' || entry.Action === 'delete' ? entry.Action : 'update';
    // A data check is confirmed or reopened, not added or removed.
    if (entry.EntityType === 'datacheck' && verb !== 'update') return t(`activity_group_datacheck_${verb}`, { items });
    return t(`activity_group_${verb}`, { items });
}

function ResumedAvatar({ p, treeId }: { p: ResumedPerson; treeId: number | null }) {
    const t = useTranslations('home');
    const tc = useTranslations('common');
    const status = livingStatus(p);
    return (
        <PersonAvatar
            mediaId={p.PrimaryMediaId}
            treeId={treeId}
            name={displayFullName(p) || t('person_fallback', { id: p.Id })}
            initials={getInitials(p.FirstName, p.LastName)}
            sex={p.Sex}
            size={48}
            focalX={p.FocalX}
            focalY={p.FocalY}
            focalRadius={p.FocalRadius}
            status={status}
            statusLabel={tc(status)}
        />
    );
}

function rolePill(p: ResumedPerson, t: Translator): string | null {
    const isFemale = p.Sex === 'F';
    const isMale = p.Sex === 'M';
    const parts: string[] = [];
    if (p.partnershipCount > 0) parts.push(t('role_spouse'));
    if (p.childrenCount > 0) parts.push(isFemale ? t('role_mother') : isMale ? t('role_father') : t('role_parent'));
    return parts.length > 0 ? parts.join(' · ') : null;
}

export default function Home() {
    const router = useRouter();
    const t = useTranslations('home');
    const tAudit = useTranslations('audit');
    const { activityTime } = useTimestamp();
    const { activeTreeId, activePermission, currentUserId } = useTree();
    const canEdit = activePermission !== 'view';

    // Let failures reject so useCachedResource records the error instead of caching
    // a swallowed null/[] as a successful value (which would stick until a write
    // cleared it). The two reads are already independent hooks, so one failing
    // doesn't sink the other, and a transient failure self-heals on the next mount.
    const dash = useCachedResource(
        currentUserId === null ? null : `dashboard:get:tree=${activeTreeId ?? 'default'}`,
        async () => (await getDataClient()).dashboard.get(activeTreeId),
    );
    const sugg = useCachedResource(
        currentUserId === null ? null : `dashboard:suggestions:tree=${activeTreeId ?? 'default'}`,
        async () => (await getDataClient()).dashboard.suggestions(activeTreeId),
    );
    // Dates to check (#834): the home card's count and top three, not the whole list (#1270).
    const checks = useCachedResource(
        currentUserId === null ? null : `dataChecks:summary:tree=${activeTreeId ?? 'default'}`,
        async () => (await getDataClient()).dataChecks.summary(activeTreeId),
    );
    const data = dash.data ?? null;
    const suggestions = sugg.data ?? [];
    const loading = dash.loading || sugg.loading;

    // Skeleton-first (delay 0): the homepage is the hard-reloaded landing page and
    // its dashboard fetch is reliably slow, so show skeletons from the first frame
    // (the prerendered HTML ships them) rather than an empty → skeleton starter phase.
    // Treat "user still resolving" (currentUserId === null before /api/users/me
    // resolves in hosted mode) as loading, so the prerendered HTML ships the
    // skeletons instead of an empty dashboard. (delay 0 = skeleton-first.)
    const phase = useLoadPhase(currentUserId === null || loading, { delay: 0 });

    const stats = data?.stats;
    const openCases = data?.openCases ?? [];
    const recentActivity = data?.recentActivity ?? [];
    const places = data?.places ?? [];
    const resumedPerson = data?.resumedPerson ?? null;
    const firstRun = stats?.people === 0;
    const datesToCheck = checks.data?.openCount ?? 0;
    const duplicates = suggestions.find(s => s.type === 'duplicates')?.count ?? 0;

    // Phones get their own page (#1061); the desktop column below hides under `md`.
    const phonePage = (
        <MobileHome data={data} phase={phase} datesToCheck={datesToCheck} duplicates={duplicates} canEdit={canEdit} treeId={activeTreeId} />
    );

    return (
        <PageShell topBar={phonePage} contentClassName="max-md:hidden">
                <div className="layout-2col-rail">

                    {/* ── LEFT: main column ── */}
                    <div>
                        {/* Welcome — segmented hero */}
                        <div className="hero-dark mb-5 py-5 px-6">
                            {/* A brand-new tree gets a first-run welcome, not "Welcome back" (#696). */}
                            <h1 className="title m-0">{firstRun ? t('welcome_first_run') : t('welcome_back')}</h1>
                            {/* The first run gets a how-to line. A returning user needs no generic
                                tagline; the resume card below says where they left off (#780, LY-5). */}
                            {firstRun && <p className="muted mt-1 text-base">{t('first_run_subtitle')}</p>}
                            {canEdit && (
                                <div className="row gap-2 mt-3.5 flex-wrap">
                                    <Button variant="primary" size="md" icon={<Plus className="w-4 h-4" aria-hidden="true" />} onClick={() => router.push('/people/new')} className="text-sm">
                                        {t('add_person_short')}
                                    </Button>
                                    {/* Most people start from an existing GEDCOM, so an empty tree
                                        offers Import here rather than a tree of nobody (FR-1). */}
                                    {firstRun ? (
                                        <Button variant="outline" icon={<Upload className="w-4 h-4" aria-hidden="true" />} onClick={() => router.push('/import-export')} className="text-sm">
                                            {t('import_gedcom')}
                                        </Button>
                                    ) : (
                                        <Button variant="outline" onClick={() => router.push('/tree')} className="text-sm">
                                            {t('view_tree_plain')}
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Resume card — most recently edited person, with lifespan + role/source pills */}
                        {phase === 'loading' && <ResumeCardSkeleton />}
                        {phase === 'ready' && resumedPerson && (() => {
                            const last = resumedPerson.lastChange;
                            const role = rolePill(resumedPerson, t);
                            const sex = resumedPerson.Sex === 'F' ? t('sex_female') : resumedPerson.Sex === 'M' ? t('sex_male') : resumedPerson.Sex === 'X' ? t('sex_nonbinary') : null;
                            return (
                                <Card accent className="mb-4 py-4 px-5" style={{ boxShadow: 'var(--shadow-md)' }}>
                                    <div className="row justify-between mb-3">
                                        <div className="row gap-3">
                                            <ResumedAvatar p={resumedPerson} treeId={activeTreeId} />
                                            <div>
                                                <div className="serif text-xl font-semibold">
                                                    {displayFullName(resumedPerson) || last.EntityLabel || t('person_fallback', { id: resumedPerson.Id })}
                                                </div>
                                                <Lifespan
                                                    variant="full"
                                                    birth={resumedPerson.BirthDate}
                                                    death={resumedPerson.DeathDate}
                                                    birthPlace={resumedPerson.BirthPlace}
                                                    deathPlace={resumedPerson.DeathPlace}
                                                    tone="muted"
                                                    className="muted text-sm block"
                                                />
                                            </div>
                                        </div>
                                        <Button variant="primary" onClick={() => router.push(`/people/view?id=${resumedPerson.Id}`)} className="text-sm">
                                            {t('open_card')}
                                        </Button>
                                    </div>
                                    <div className="row gap-x-3 gap-y-1.5 flex-wrap mb-3">
                                        {(sex || role) && <span className="text-sm text-text-muted">{[sex, role].filter(Boolean).join(' · ')}</span>}
                                        {resumedPerson.totalFacts > 0 && (
                                            <span className={`text-sm ${resumedPerson.sourcedFacts >= resumedPerson.totalFacts ? 'text-evidence' : 'text-text-muted'}`}>
                                                {t('facts_sourced', { sourced: resumedPerson.sourcedFacts, total: resumedPerson.totalFacts })}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-sm border-t border-t-[color:var(--border-light)] pt-3" style={{ color: 'var(--text-2)' }}>
                                        <span className="muted">{t('last_change')}</span>
                                        <span>{formatAction(last, t, tAudit)}</span>
                                        <span className="muted"> · {activityTime(last.CreatedAt)}</span>
                                    </div>
                                </Card>
                            );
                        })()}


                        {/* Cases in progress: the dashboard lists only in_progress (#767).
                            An empty tree hides both empty cards until they have content (FR-1). */}
                        {!(firstRun && openCases.length === 0) && (<>
                        <div className="row justify-between mb-2.5">
                            <h2 className="section serif m-0">
                                {t('cases_in_progress_title')} {phase === 'ready' && <span className="muted font-normal text-sm">({openCases.length})</span>}
                            </h2>
                            <Link href="/cases" className="text-meta text-link hover:underline">{t('view_all')}</Link>
                        </div>
                        {/* overflow-hidden: the row hover background paints to the row's
                            square bounds, so without it the first/last rows bleed past
                            the card's radius on hover. */}
                        <div className="card overflow-hidden mb-6">
                            {phase === 'loading' ? (
                                <HomeListSkeleton rows={2} />
                            ) : phase === 'pending' ? null : openCases.length === 0 ? (
                                <div className="py-6 px-4 text-center">
                                    <div className="muted text-sm mb-2.5">{t('no_cases_in_progress')}</div>
                                    {canEdit && <Button variant="outline" onClick={() => router.push('/cases')} className="text-meta">{t('start_a_case')}</Button>}
                                </div>
                            ) : (
                                openCases.map((c, i) => (
                                    <Link
                                        key={c.Id}
                                        href={`/cases/view?id=${c.Id}`}
                                        // ring-inset: the rows are full-bleed inside an
                                        // overflow-hidden card, so a normal focus ring
                                        // would be clipped away on the outer edges.
                                        className={`row py-3.5 px-4 justify-between items-start gap-3 no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${i < openCases.length - 1 ? 'border-b border-b-[color:var(--border-light)]' : ''}`}
                                        style={{ color: 'inherit' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-base">{c.Title}</div>
                                            {c.LastComment && (
                                                <div className="muted text-meta mt-1 italic truncate">
                                                    &ldquo;{c.LastComment}&rdquo;
                                                </div>
                                            )}
                                            <div className="row gap-1.5 mt-1.5 flex-wrap">
                                                {(c.Tags || []).map(tag => <Badge key={tag}>{tag}</Badge>)}
                                                <span className="muted text-xs ml-1">{t('updated_ago', { time: activityTime(c.UpdatedAt) })}</span>
                                            </div>
                                        </div>
                                        <CaseStatus status="in_progress" className="shrink-0" />
                                    </Link>
                                ))
                            )}
                        </div>
                        </>)}

                        {/* Recent activity — same heading/View-all pairing as Open cases. */}
                        {!(firstRun && recentActivity.length === 0) && (<>
                        <div className="row justify-between mb-2.5">
                            <h2 className="section serif m-0">{t('recent_activity_plain')}</h2>
                            <Link href="/audit" className="text-meta text-link hover:underline">{t('view_all')}</Link>
                        </div>
                        {/* overflow-hidden: same row-hover bleed as the open-cases card. */}
                        <div className="card overflow-hidden">
                            {phase === 'loading' ? (
                                <HomeListSkeleton rows={4} />
                            ) : phase === 'pending' ? null : recentActivity.length === 0 ? (
                                <div className="muted py-6 px-4 text-center text-sm">{t('no_recent_activity_dot')}</div>
                            ) : (
                                recentActivity.map((a, i) => (
                                    <Link
                                        key={a.Id}
                                        href={a.GroupCount > 1 ? '/audit' : getEntityLink(a)}
                                        // ring-inset: same clip as the open-cases rows.
                                        className={`row py-2.5 px-4 gap-3 no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${i < recentActivity.length - 1 ? 'border-b border-b-[color:var(--border-light)]' : ''}`}
                                        style={{ color: 'inherit' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--text-muted)' }} />
                                        <div className="flex-1 text-sm">
                                            {a.EntityType === 'import' ? (
                                                <span className="font-semibold">{formatImport(a, t)}</span>
                                            ) : a.GroupCount > 1 ? (
                                                <span className="font-semibold">{formatGroup(a, t)}</span>
                                            ) : (
                                                <>
                                                    {a.EntityLabel ? <EntityLabelText label={a.EntityLabel} /> : <span className="font-semibold">{t('entity_fallback', { type: a.EntityType, id: a.EntityId })}</span>}
                                                    <span className="muted">{t('activity_action', { action: formatAction(a, t, tAudit) })}</span>
                                                </>
                                            )}
                                        </div>
                                        <span className="muted text-meta">{activityTime(a.CreatedAt)}</span>
                                    </Link>
                                ))
                            )}
                        </div>
                        </>)}
                    </div>

                    {/* ── RIGHT RAIL ── the shared DetailRail recipe: cards on the page,
                        headings inside, no grey well (#764). */}
                    <aside>
                    <DetailRail>
                        {/* Tree at a glance */}
                        <div className="card card-pad">
                            <SectionHeader level="rail" title={t('tree_at_glance')} />
                            <div className="grid gap-2.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                {/* Static stat tiles: read-outs, not navigation. They used to be
                                    links, which promised a filtered view they never delivered —
                                    so no button chrome, no hover, no focus ring, not tabbable. */}
                                {([
                                    ['people', t('people')],
                                    ['families', t('families')],
                                    ['events', t('events')],
                                    ['sources', t('label_sources')],
                                ] as const).map(([key, label]) => (
                                    <div key={key}>
                                        <div className="serif text-[24px] font-semibold" style={{ color: 'var(--text)' }}>
                                            {phase !== 'ready'
                                                ? <span className="skeleton inline-block w-8 h-5 rounded-[4px]" style={{ verticalAlign: 'middle' }} aria-hidden="true" />
                                                : (stats?.[key] ?? 0).toLocaleString()}
                                        </div>
                                        <div className="muted text-meta">{label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <DatesToCheckCard summary={checks.data} treeId={activeTreeId} />

                        {/* Suggestions */}
                        <div className="card card-pad">
                            <SectionHeader level="rail" title={t('suggestions_title')} />
                            {phase === 'loading' ? (
                                <HomeListSkeleton rows={2} divided={false} />
                            ) : phase === 'pending' ? null : suggestions.length === 0 ? (
                                <div className="muted text-sm">{t('no_suggestions')}</div>
                            ) : (
                                <div className="text-sm leading-normal">
                                    {suggestions.map((s, i) => (
                                        <div key={s.type} className={`py-2 px-0 ${i < suggestions.length - 1 ? 'border-b border-b-[color:var(--border-light)]' : ''}`}>
                                            <div className="font-medium">{t(`suggestion_${s.type}`, { count: s.count })}</div>
                                            <Link href={s.href} className="text-meta text-link hover:underline">{t('review')}</Link>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Places hot list */}
                        {(phase === 'loading' || places.length > 0) && (
                            <div className="card card-pad">
                                <SectionHeader level="rail" title={t('places_top')} />
                                {phase === 'loading' && <HomeListSkeleton rows={4} divided={false} />}
                                {phase === 'ready' && places.map(p => (
                                    <Link
                                        key={p.place_id}
                                        href={placeHref({ id: p.place_id, name: p.place_name })}
                                        // row-lift is the app's existing interactive-row
                                        // treatment (relationship rows, family sections);
                                        // -mx-2 lets the hover surface breathe past the text.
                                        className="row row-lift gap-3 py-1.5 px-2 -mx-2 justify-between no-underline focus-ring"
                                    >
                                        {/* Full name, truncated by CSS. Cutting at the first
                                            comma rendered 'Dover' and 'Dover, Kent, England'
                                            as two identical rows with different counts. */}
                                        <span className="text-sm truncate min-w-0" title={p.place_name} style={{ color: 'var(--text)' }}>
                                            {p.place_name}
                                        </span>
                                        <span className="flex items-baseline gap-2 shrink-0">
                                            {/* The count rolls up this place's gazetteer
                                                sub-places, matching the page the row opens.
                                                Say so, or the number looks wrong beside the
                                                place's own records. Dormant while ancestor
                                                suppression drops any place a record-owning
                                                descendant covers (decision 2026-07-27) — kept
                                                so a relaxed rule needs no UI change. */}
                                            {Number(p.own_count) < Number(p.person_count) && (
                                                <span className="muted text-[10.5px]">{t('incl_subplaces')}</span>
                                            )}
                                            <span className="muted text-meta">{t('records_count', { count: p.person_count })}</span>
                                        </span>
                                    </Link>
                                ))}
                            </div>
                        )}

                    </DetailRail>
                    </aside>
                </div>
        </PageShell>
    );
}
