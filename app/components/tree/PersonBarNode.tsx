import React, { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Handle, Position, NodeProps, useStore } from 'reactflow';
import { FlowNodeData } from './types';
import ProfileImage from '../ProfileImage';
import { useTree } from '@/app/contexts/TreeContext';
import { BAR_CARD_WIDTH, BAR_CARD_HEIGHT } from '@/lib/tree/geometry';
import { personCardModel, getZoomedOutFontSize } from './personCardModel';
import { TreeCardLifespan } from './TreeCardLifespan';
import { avatarClass } from '@/lib/utils/avatar';
import { StatusMark } from '../ui/StatusMark';
import { Home as House } from '@/lib/icons';

/**
 * PersonBarNode — the compact horizontal-orientation card (188×44).
 *
 * A "longer line" alternative to the portrait PersonNode: a small round avatar
 * chip followed by name + dates on a single stacked text block, so more
 * generations fit across the screen. Name/initials derivation is shared
 * with PersonNode via personCardModel(), keeping the two cards consistent.
 *
 * Handles mirror PersonNode's full set so the horizontal layout can route
 * parent→child edges left↔right and spouse connectors top↔bottom.
 *
 * The 14px status mark sits at the bar's right end, with the age just before it
 * when ages are on (#736, #271).
 */
const AVATAR = 30;

const PersonBarNode: React.FC<NodeProps<FlowNodeData>> = ({ data }) => {
  const { activeTreeId } = useTree();
  const person = data.person;
  const tc = useTranslations('common');
  const { displayName, initials, status, age } = personCardModel(person);
  const shownAge = data.showAgeIndicator ? age : null;
  const { lifespan } = person;

  // Zoomed-out treatment mirrors PersonNode: below the threshold, drop the date
  // and let the name flow onto a second line at a scaled-up size (so it stays
  // legible as React Flow shrinks the card). Threshold is debug-adjustable.
  const zoomThreshold = data.barZoomThreshold ?? 0.6;
  const isZoomedOut = useStore((s) => s.transform[2] < zoomThreshold);
  const NAME_WIDTH = BAR_CARD_WIDTH - AVATAR - 8 - 20 - 14 - 8; // minus avatar, gap, padding, status mark, gap ≈ 108

  const personId = 'id' in person ? person.id : 0;

  const handleClick = () => {
    if (personId && data.onPersonClick) data.onPersonClick(personId);
  };
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (personId && data.onPersonDoubleClick) {
      e.stopPropagation();
      data.onPersonDoubleClick(personId);
    }
  };

  return (
    <>
      {/* Four-sided handle set: parent→child edges route right↔left in the normal
          case and left↔right for ancestor-mode sibling edges (parent on the right);
          spouse connectors route top↔bottom. */}
      <Handle type="source" position={Position.Top} id="top" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} id="top-target" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} id="bottom-target" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="right" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right} id="right-target" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} id="left-source" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} id="left" style={{ opacity: 0 }} />

      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className={`bg-card rounded-lg shadow-md cursor-pointer hover:shadow-lg transition-all overflow-hidden border border-border ${
          data.isSidebarSelected ? 'tree-card--picked' : ''
        }`}
        style={{
          width: `${BAR_CARD_WIDTH}px`,
          height: `${BAR_CARD_HEIGHT}px`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          position: 'relative',
        }}
      >
        {/* The start person keeps a small house marker; the open card is outlined navy (fix 09). */}
        {data.isSelected && (
          <span className="tree-card-start" aria-hidden="true"><House className="w-2.5 h-2.5" /></span>
        )}
        {/* Avatar chip */}
        <div
          className="flex items-center justify-center overflow-hidden"
          style={{ width: AVATAR, height: AVATAR, flexShrink: 0 }}
        >
          {person.photoMediaId != null ? (
            <ProfileImage
              mediaId={person.photoMediaId}
              treeId={activeTreeId}
              alt={displayName}
              focalX={'focalX' in person ? person.focalX : undefined}
              focalY={'focalY' in person ? person.focalY : undefined}
              focalRadius={'focalRadius' in person ? person.focalRadius : undefined}
              containerWidth={AVATAR}
              containerHeight={AVATAR}
              circular={true}
              className="border-2 border-card"
            />
          ) : (
            <div
              className={`rounded-full flex items-center justify-center overflow-hidden ${avatarClass(person.sex)}`}
              style={{ width: AVATAR, height: AVATAR, flexShrink: 0 }}
            >
              <span className="text-white font-semibold" style={{ fontSize: 12 }}>{initials}</span>
            </div>
          )}
        </div>

        {/* Name + dates */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            className="text-text"
            style={
              isZoomedOut
                ? {
                    fontSize: getZoomedOutFontSize(displayName, NAME_WIDTH, 18),
                    fontWeight: 600,
                    lineHeight: 1.15,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }
                : { fontSize: 13, fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
            }
          >
            {displayName}
          </p>
          {!isZoomedOut && lifespan && (lifespan.birth || lifespan.death) && (
            <p
              style={{ fontSize: 11, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              <TreeCardLifespan lifespan={lifespan} />
            </p>
          )}
        </div>

        {shownAge !== null && (
          <span aria-hidden="true" className="tree-bar-age">{shownAge}</span>
        )}
        {data.showStatusMark !== false && <StatusMark status={status} size="tree" label={tc(status)} />}
      </div>
    </>
  );
};

export default memo(PersonBarNode);
