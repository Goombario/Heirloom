import React, { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Handle, Position, NodeProps, useStore } from 'reactflow';
import type { FlowNodeData, Spouse, TreeNode } from './types';
import ProfileImage from '../ProfileImage';
import { useTree } from '@/app/contexts/TreeContext';
import { BAR_CARD_WIDTH, COUPLE_BAR_HEIGHT, COUPLE_CARD_WIDTH, PARTNER_JOIN_SIZE, personCardHeight } from '@/lib/tree/geometry';
import { personCardModel, getZoomedOutFontSize } from './personCardModel';
import { TreeCardLifespan } from './TreeCardLifespan';
import { avatarClass } from '@/lib/utils/avatar';
import { StatusMark } from '../ui/StatusMark';
import { RelateBadge } from './RelateMark';

/**
 * One couple card (#248, Display › Partners › One couple card): a person with one
 * partner drawn as a single card, the blood relative on the left (the top row of a
 * horizontal bar) so the line from their parents lands on them, and the partner
 * beside them. Children's lines leave the middle, where the two meet. Each half
 * is its own button-like target: a click opens that person, as their own card does.
 */

const PHOTO_HEIGHT = 72;
const HALF_WIDTH = COUPLE_CARD_WIDTH / 2;
const NAME_WIDTH = HALF_WIDTH - 12;
const BAR_ROW = COUPLE_BAR_HEIGHT / 2;
const BAR_AVATAR = 20;

type Half = {
    person: TreeNode | Spouse;
    relate?: FlowNodeData['relate'];
    picked: boolean;
    target: boolean;
    secondName?: string | null;
    mainName?: string;
    underText?: string | null;
};

/** The two halves: the person, then their partner, each with their own decoration. */
function halves(data: FlowNodeData): [Half, Half] {
    const pv = data.partnerView;
    return [
        { person: data.person, relate: data.relate, picked: !!data.isSidebarSelected, target: !!data.isSelected, secondName: data.secondName, mainName: data.mainName, underText: data.underText },
        { person: data.partner!, relate: pv?.relate, picked: !!pv?.isSidebarSelected, target: false, secondName: pv?.secondName, mainName: pv?.mainName, underText: pv?.underText },
    ];
}

function useHalfHandlers(data: FlowNodeData, personId: number) {
    return {
        onClick: (e: React.MouseEvent) => { if (personId && data.onPersonClick) data.onPersonClick(personId, { shift: e.shiftKey }); },
        onDoubleClick: (e: React.MouseEvent) => {
            if (personId && data.onPersonDoubleClick) { e.stopPropagation(); data.onPersonDoubleClick(personId); }
        },
    };
}

const halfClass = (h: Half) => `tree-couple-half${
    h.relate === 'first' || h.relate === 'second' ? ' tree-couple-half--path-end' : h.relate === 'on' ? ' tree-couple-half--path'
    : h.picked ? ' tree-couple-half--picked' : h.target ? ' tree-couple-half--target' : ''}`;

/** The couple card fades only when neither half is on the path. */
const coupleClass = (data: FlowNodeData) => (data.relate === 'dim' && (!data.partnerView?.relate || data.partnerView.relate === 'dim') ? ' tree-card--dim' : '');

/** The rings on the divider: the two are a couple. Decorative. */
function Rings() {
    return (
        <span aria-hidden="true" className="tree-couple-rings">
            <svg width="12" height="8" viewBox="0 0 12 8"><circle cx="4" cy="4" r="3" /><circle cx="8" cy="4" r="3" /></svg>
        </span>
    );
}

function PortraitHalf({ half, data, secondNameOn, isZoomedOut }: { half: Half; data: FlowNodeData; secondNameOn: boolean; isZoomedOut: boolean }) {
    const { activeTreeId } = useTree();
    const tc = useTranslations('common');
    const p = half.person;
    const personId = 'id' in p ? p.id : 0;
    const { displayName, initials, status, age } = personCardModel(half.mainName ? { ...p, name: half.mainName } : p);
    const shownAge = data.showAgeIndicator ? age : null;
    const handlers = useHalfHandlers(data, personId);
    return (
        <div {...handlers} className={halfClass(half)} style={{ width: HALF_WIDTH, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div className="relative flex items-center justify-center overflow-hidden" style={{ width: '100%', height: PHOTO_HEIGHT, flexShrink: 0 }}>
                {p.photoMediaId != null ? (
                    <ProfileImage
                        mediaId={p.photoMediaId}
                        treeId={activeTreeId}
                        alt={displayName}
                        focalX={p.focalX}
                        focalY={p.focalY}
                        focalRadius={p.focalRadius}
                        containerWidth={HALF_WIDTH}
                        containerHeight={PHOTO_HEIGHT}
                        circular={false}
                    />
                ) : (
                    <div className={`flex items-center justify-center overflow-hidden ${avatarClass(p.sex)}`} style={{ width: '100%', height: PHOTO_HEIGHT }}>
                        <span className="text-white font-semibold text-md">{initials}</span>
                    </div>
                )}
                {shownAge !== null && (
                    <div aria-hidden="true" className="tree-card-fade"><span className="tree-card-age">{shownAge}</span></div>
                )}
                {data.showStatusMark !== false && <StatusMark status={status} size="tree" corner className="status-tree" label={tc(status)} />}
            </div>
            <div className="p-1.5" style={{ flex: 1, minHeight: 0, textAlign: 'center', display: 'flex', flexDirection: 'column' }}>
                <p
                    className="text-text"
                    style={{
                        fontSize: isZoomedOut ? `${getZoomedOutFontSize(displayName, NAME_WIDTH, 18)}px` : '15px',
                        overflow: 'hidden',
                        maxWidth: NAME_WIDTH,
                        lineHeight: '1.3',
                        display: '-webkit-box',
                        WebkitLineClamp: isZoomedOut ? 3 : 2,
                        WebkitBoxOrient: 'vertical',
                    }}
                >
                    {displayName}
                </p>
                {secondNameOn && !isZoomedOut && (
                    <p className="tree-card-second-name" title={half.secondName ?? undefined}>{half.secondName}</p>
                )}
                {!isZoomedOut && data.underName && (
                    <p className="tree-card-dates tree-card-under" title={half.underText ?? undefined}>{half.underText ?? ' '}</p>
                )}
                {!isZoomedOut && !data.underName && p.lifespan && (p.lifespan.birth || p.lifespan.death) && (
                    <p className="tree-card-dates"><TreeCardLifespan lifespan={p.lifespan} /></p>
                )}
            </div>
        </div>
    );
}

/** The portrait couple card: two halves, a divider and the rings. */
const CoupleNodeInner: React.FC<NodeProps<FlowNodeData>> = ({ data }) => {
    const isZoomedOut = useStore((s) => s.transform[2] < 0.6);
    const secondNameOn = !!data.secondNameOn;
    if (!data.partner) return null;
    const [a, b] = halves(data);
    return (
        <>
            {/* The line from the parents lands on the blood relative's half; the
                children's lines leave the middle, where the two meet. */}
            <Handle type="target" position={Position.Top} id="top-target" style={{ opacity: 0, left: '25%' }} />
            <Handle type="source" position={Position.Top} id="top" style={{ opacity: 0 }} />
            <Handle type="source" position={Position.Bottom} id="bottom" style={{ opacity: 0 }} />
            <Handle type="target" position={Position.Bottom} id="bottom-target" style={{ opacity: 0, left: '25%' }} />
            <RelateBadge relate={a.relate} />
            <RelateBadge relate={b.relate} className="tree-relate-badge--right" />
            <div
                className={`tree-couple bg-card rounded-lg shadow-md overflow-hidden border border-border${coupleClass(data)}`}
                style={{ width: COUPLE_CARD_WIDTH, height: personCardHeight(secondNameOn), display: 'flex', position: 'relative' }}
            >
                <PortraitHalf half={a} data={data} secondNameOn={secondNameOn} isZoomedOut={isZoomedOut} />
                <span aria-hidden="true" className="tree-couple-divider" />
                <PortraitHalf half={b} data={data} secondNameOn={secondNameOn} isZoomedOut={isZoomedOut} />
                <Rings />
            </div>
        </>
    );
};

function BarRow({ half, data, isZoomedOut }: { half: Half; data: FlowNodeData; isZoomedOut: boolean }) {
    const { activeTreeId } = useTree();
    const tc = useTranslations('common');
    const p = half.person;
    const personId = 'id' in p ? p.id : 0;
    const { displayName, initials, status } = personCardModel(p);
    const handlers = useHalfHandlers(data, personId);
    return (
        <div {...handlers} className={`${halfClass(half)} gap-2 px-2.5`} style={{ height: BAR_ROW, display: 'flex', alignItems: 'center' }}>
            <div className="flex items-center justify-center overflow-hidden" style={{ width: BAR_AVATAR, height: BAR_AVATAR, flexShrink: 0 }}>
                {p.photoMediaId != null ? (
                    <ProfileImage
                        mediaId={p.photoMediaId}
                        treeId={activeTreeId}
                        alt={displayName}
                        focalX={p.focalX}
                        focalY={p.focalY}
                        focalRadius={p.focalRadius}
                        containerWidth={BAR_AVATAR}
                        containerHeight={BAR_AVATAR}
                        circular={true}
                    />
                ) : (
                    <div className={`rounded-full flex items-center justify-center overflow-hidden ${avatarClass(p.sex)}`} style={{ width: BAR_AVATAR, height: BAR_AVATAR }}>
                        <span className="text-white font-semibold tree-couple-bar-initials">{initials}</span>
                    </div>
                )}
            </div>
            <p className="text-text tree-couple-bar-name">
                {displayName}
            </p>
            {!isZoomedOut && data.underName && (
                <span className="tree-couple-bar-meta tree-card-under" title={half.underText ?? undefined}>{half.underText ?? ''}</span>
            )}
            {!isZoomedOut && !data.underName && p.lifespan && (p.lifespan.birth || p.lifespan.death) && (
                <span className="tree-couple-bar-meta"><TreeCardLifespan lifespan={p.lifespan} /></span>
            )}
            {data.showStatusMark !== false && <StatusMark status={status} size="tree" label={tc(status)} />}
        </div>
    );
}

/** The horizontal couple bar: two 31px rows, the blood relative on top. */
const CoupleBarNodeInner: React.FC<NodeProps<FlowNodeData>> = ({ data }) => {
    const zoomThreshold = data.barZoomThreshold ?? 0.6;
    const isZoomedOut = useStore((s) => s.transform[2] < zoomThreshold);
    if (!data.partner) return null;
    const [a, b] = halves(data);
    return (
        <>
            <Handle type="target" position={Position.Left} id="left" style={{ opacity: 0, top: '25%' }} />
            <Handle type="source" position={Position.Left} id="left-source" style={{ opacity: 0 }} />
            <Handle type="source" position={Position.Right} id="right" style={{ opacity: 0 }} />
            <Handle type="target" position={Position.Right} id="right-target" style={{ opacity: 0, top: '25%' }} />
            <RelateBadge relate={a.relate} />
            <RelateBadge relate={b.relate} className="tree-relate-badge--lower" />
            <div
                className={`tree-couple bg-card rounded-lg shadow-md overflow-hidden border border-border${coupleClass(data)}`}
                style={{ width: BAR_CARD_WIDTH, height: COUPLE_BAR_HEIGHT, display: 'flex', flexDirection: 'column' }}
            >
                <BarRow half={a} data={data} isZoomedOut={isZoomedOut} />
                <span aria-hidden="true" className="tree-couple-divider tree-couple-divider--row" />
                <BarRow half={b} data={data} isZoomedOut={isZoomedOut} />
            </div>
        </>
    );
};

/**
 * A numbered join between a person and one of several partners (#248): the
 * marriage's number in a small circle on the line between them. That marriage's
 * children's lines leave from it. Decorative for screen readers; nothing to click.
 */
const PartnerJoinNodeInner: React.FC<NodeProps<FlowNodeData>> = ({ data }) => (
    <>
        <Handle type="source" position={Position.Bottom} id="bottom" style={{ opacity: 0 }} />
        <Handle type="source" position={Position.Top} id="top" style={{ opacity: 0 }} />
        <Handle type="source" position={Position.Right} id="right" style={{ opacity: 0 }} />
        <Handle type="source" position={Position.Left} id="left-source" style={{ opacity: 0 }} />
        <div aria-hidden="true" className="tree-partner-join" style={{ width: PARTNER_JOIN_SIZE, height: PARTNER_JOIN_SIZE }}>
            {data.joinNumber}
        </div>
    </>
);

export const CoupleNode = memo(CoupleNodeInner);
export const CoupleBarNode = memo(CoupleBarNodeInner);
export const PartnerJoinNode = memo(PartnerJoinNodeInner);
