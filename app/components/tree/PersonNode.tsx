import React, { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Handle, Position, NodeProps, useStore } from 'reactflow';
import { FlowNodeData } from './types';
import ProfileImage from '../ProfileImage';
import { useTree } from '@/app/contexts/TreeContext';
import { PERSON_CARD_WIDTH, personCardHeight } from '@/lib/tree/geometry';
import { personCardModel, getZoomedOutFontSize } from './personCardModel';
import { TreeCardLifespan } from './TreeCardLifespan';
import { avatarClass } from '@/lib/utils/avatar';
import { StatusMark } from '../ui/StatusMark';

const PHOTO_HEIGHT = 64;

/**
 * PersonNode Component
 *
 * Compact portrait card with:
 * - Photo area (64px): profile photo or initials, with the 14px status mark
 *   raised in its bottom-right corner and, when ages are on, the age at the
 *   left on a soft fade (#736 B7)
 * - Info strip: abbreviated name, the optional second name line (the Display
 *   menu's "Second name", which makes the card 16px taller), and the dates,
 *   which always sit on the card's bottom edge
 *
 * Name/initials/status/age derivation and zoomed-out font sizing are shared
 * with PersonBarNode via `personCardModel` (see personCardModel.ts). This
 * component owns only the portrait-card markup.
 */

const PersonNode: React.FC<NodeProps<FlowNodeData>> = ({ data }) => {
  // Subscribe only to the boolean the card actually needs, not the raw zoom
  // level: the selector returns a stable boolean that changes only when the
  // 0.6 threshold is crossed, so a zoom gesture no longer re-renders every card
  // on every frame — just the one frame where zoomed-out state flips.
  const isZoomedOut = useStore((s) => s.transform[2] < 0.6);
  const { activeTreeId } = useTree();
  const person = data.person;
  const personId = 'id' in person ? person.id : 0;
  const tc = useTranslations('common');
  // With Nickname as the second name, the main line is the original name.
  const { displayName, initials, status, age } = personCardModel(data.mainName ? { ...person, name: data.mainName } : person);
  const secondNameOn = !!data.secondNameOn;
  const shownAge = data.showAgeIndicator ? age : null;
  const statusLabel = tc(status);
  const { lifespan } = person;

  const handleClick = () => {
    if (personId && data.onPersonClick) {
      data.onPersonClick(personId);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (personId && data.onPersonDoubleClick) {
      e.stopPropagation();
      data.onPersonDoubleClick(personId);
    }
  };

  return (
    <>
      {/* Connection handles for React Flow edges */}
      <Handle type="source" position={Position.Top} id="top" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} id="top-target" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} id="bottom-target" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="right" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} id="left" style={{ opacity: 0 }} />

      {/* Person Card */}
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className={`bg-card rounded-lg shadow-md cursor-pointer hover:shadow-lg transition-all overflow-hidden border border-border ${
          data.isSidebarSelected ? 'tree-card--picked' : ''
        }`}
        style={{ width: `${PERSON_CARD_WIDTH}px`, height: `${personCardHeight(secondNameOn)}px`, display: 'flex', flexDirection: 'column', position: 'relative' }}
      >
        {/* Photo Area */}
        <div
          className="relative flex items-center justify-center overflow-hidden"
          style={{ width: '100%', height: `${PHOTO_HEIGHT}px`, flexShrink: 0, background: 'var(--color-card-secondary, color-mix(in srgb, var(--color-card) 80%, black))' }}
        >
          {person.photoMediaId != null ? (
            <ProfileImage
              mediaId={person.photoMediaId}
              treeId={activeTreeId}
              alt={displayName}
              focalX={'focalX' in person ? person.focalX : undefined}
              focalY={'focalY' in person ? person.focalY : undefined}
              focalRadius={'focalRadius' in person ? person.focalRadius : undefined}
              containerWidth={96}
              containerHeight={PHOTO_HEIGHT}
              circular={false}
            />
          ) : (
            <div
              className={`flex items-center justify-center overflow-hidden ${avatarClass(person.sex)}`}
              style={{ width: '100%', height: `${PHOTO_HEIGHT}px`, flexShrink: 0 }}
            >
              <span className="text-white font-semibold" style={{ fontSize: '17px' }}>
                {initials}
              </span>
            </div>
          )}

          {/* Ages on (#736 B7, "split on a fade"): a soft dark fade rises from the
              photo's foot, the age sits at the left and the mark stays at the right. */}
          {shownAge !== null && (
            <div aria-hidden="true" className="tree-card-fade">
              <span className="tree-card-age">{shownAge}</span>
            </div>
          )}
          {data.showStatusMark !== false && <StatusMark status={status} size="tree" corner className="status-tree" label={statusLabel} />}
        </div>

        {/* Info Strip */}
        {/* A column filling the rest of the card, so the dates can sit on its
            bottom edge whether the name takes one line or two. */}
        <div style={{ flex: 1, minHeight: 0, padding: '6px 6px 6px', textAlign: 'center', display: 'flex', flexDirection: 'column' }}>
          <p
            className="text-text"
            style={{
              fontSize: isZoomedOut ? `${getZoomedOutFontSize(displayName, 84, 18)}px` : '16px',
              // fontWeight: isZoomedOut ? 500 : undefined,
              overflow: 'hidden',
              maxWidth: '84px',
              lineHeight: '1.3',
              display: '-webkit-box',
              WebkitLineClamp: isZoomedOut ? 3 : 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {displayName}
          </p>
          {/* The second name line (vertical cards only). The line keeps its height
              when this person has no name of the chosen type, so a row stays level. */}
          {secondNameOn && !isZoomedOut && (
            <p
              className="tree-card-second-name"
              lang={data.secondName ? secondNameLang(data.secondName) : undefined}
              title={data.secondName ?? undefined}
            >
              {data.secondName}
            </p>
          )}
          {!isZoomedOut && lifespan && (lifespan.birth || lifespan.death) && (
            <p
              // 11px, like the bar card (#1215): at 12px the widest lifespan
              // ("~1796 – ~1819") fit in its 88px with only 4px to spare, and a fallback
              // mono font, which draws the thin spaces full width, cut it off. At 11px it
              // is 77px with the card's font and 86px with a fallback. The line still
              // borrows 3px of the strip's side padding each side (#934). It sits on
              // the card's bottom edge (.tree-card-dates).
              className="tree-card-dates"
            >
              <TreeCardLifespan lifespan={lifespan} />
            </p>
          )}
        </div>
      </div>
    </>
  );
};

/**
 * A `lang` hint for a second name written in Chinese or Japanese script, so the
 * browser picks a CJK face with the right glyph forms at the small size. Other
 * scripts inherit the page language.
 */
function secondNameLang(name: string): string | undefined {
  if (/[\u3040-\u30ff]/.test(name)) return 'ja';
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(name)) return 'zh';
  if (/[\uac00-\ud7af]/.test(name)) return 'ko';
  return undefined;
}

export default memo(PersonNode);
