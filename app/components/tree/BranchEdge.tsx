'use client';

import { getSmoothStepPath, EdgeProps, Position } from 'reactflow';
import { BranchEdgeData } from './types';

const SIZE = 9;

/**
 * Renders an SVG shape marker for colorblind mode.
 * Shapes cycle through: square (0), circle (1), triangle (2), diamond (3).
 * `scale` shrinks the whole marker (marker + stroke) — horizontal layouts use
 * ~half size so the markers sit neatly on the shorter horizontal stalks.
 */
function ShapeMarker({ index, x, y, color, scale = 1 }: { index: number; x: number; y: number; color: string; scale?: number }) {
  const S = SIZE * scale;
  const sharedProps = { fill: color, stroke: 'var(--color-card)', strokeWidth: 3.5 * scale };
  switch (index % 4) {
    case 0: // Square
      return <rect x={x - S} y={y - S} width={S * 2} height={S * 2} {...sharedProps} />;
    case 1: // Circle
      return <circle cx={x} cy={y} r={S} {...sharedProps} />;
    case 2: // Triangle (pointing up)
      return (
        <polygon
          points={`${x},${y - S * 1.2} ${x + S * 1.1},${y + S * 0.8} ${x - S * 1.1},${y + S * 0.8}`}
          {...sharedProps}
        />
      );
    case 3: // Diamond
      return (
        <polygon
          points={`${x},${y - S * 1.3} ${x + S},${y} ${x},${y + S * 1.3} ${x - S},${y}`}
          {...sharedProps}
        />
      );
    default:
      return null;
  }
}

/** React Flow's default smoothstep stalk: how far the line leaves a handle before turning. */
const DEFAULT_STALK = 20;

/**
 * The stalk length for a gap between rows. React Flow walks DEFAULT_STALK out of
 * each handle; when the two stalks overlap (a gap under 40px, as at Tight spacing),
 * it thinks the child sits behind the parent and routes the line through a jog at
 * the parents' midpoint, so every sibling line kinks. Keeping each stalk just under
 * half the gap leaves the bus at the gap's middle, where it always was.
 */
function stalkOffset(gap: number): number {
  return Math.max(0, Math.min(DEFAULT_STALK, Math.abs(gap) / 2 - 1));
}

/**
 * Custom React Flow edge for parent-child connections. Renders the same smoothstep path
 * as the built-in type (it is registered for 'smoothstep' too), moving the drop to
 * `data.snapTo` when set (#15), and, for a parent with several partners, overlays a
 * shape marker when colorblind mode is on.
 */
export default function BranchEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
}: EdgeProps<BranchEdgeData>) {
  const horizontal =
    sourcePosition === Position.Left || sourcePosition === Position.Right ||
    targetPosition === Position.Left || targetPosition === Position.Right;
  // A drop snapped onto a near child (#15) leaves the parent there instead.
  const snap = data?.snapTo;
  const [edgePath] = getSmoothStepPath({
    sourceX: snap !== undefined && !horizontal ? snap : sourceX,
    sourceY: snap !== undefined && horizontal ? snap : sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
    offset: stalkOffset(horizontal ? targetX - sourceX : targetY - sourceY),
  });

  const shapeIndex = data?.shapeIndex ?? 0;
  const colorblindMode = data?.colorblindMode ?? false;
  const color = (style.stroke as string) || '#374151';

  // Offset each marker from its handle along the stalk. Vertical layouts stalk
  // along Y (top/bottom handles); horizontal layouts stalk along X (left/right
  // handles) and use half-size markers to suit the shorter horizontal segments.
  const STALK_OFFSET = 15;
  const markerScale = horizontal ? 0.5 : 1;

  const dropX = snap !== undefined && !horizontal ? snap : sourceX;
  const dropY = snap !== undefined && horizontal ? snap : sourceY;
  const sourceMarkerX = horizontal
    ? (sourcePosition === Position.Right ? sourceX + STALK_OFFSET : sourceX - STALK_OFFSET)
    : dropX;
  const sourceMarkerY = horizontal
    ? dropY
    : (sourcePosition === Position.Bottom ? sourceY + STALK_OFFSET : sourceY - STALK_OFFSET);
  const targetMarkerX = horizontal
    ? (targetPosition === Position.Left ? targetX - STALK_OFFSET : targetX + STALK_OFFSET)
    : targetX;
  const targetMarkerY = horizontal
    ? targetY
    : (targetPosition === Position.Top ? targetY - STALK_OFFSET : targetY + STALK_OFFSET);

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        style={style}
        className="react-flow__edge-path"
      />
      {colorblindMode && (
        <>
          {/* Just after the source (parent/spouse) handle */}
          <ShapeMarker index={shapeIndex} x={sourceMarkerX} y={sourceMarkerY} color={color} scale={markerScale} />
          {/* Just before the target (child) handle */}
          <ShapeMarker index={shapeIndex} x={targetMarkerX} y={targetMarkerY} color={color} scale={markerScale} />
        </>
      )}
    </>
  );
}
