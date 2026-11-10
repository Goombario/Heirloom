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

/**
 * Custom React Flow edge for parent-child connections where the parent has multiple spouses.
 * Renders the same smoothstep path as the built-in type, and optionally overlays a shape
 * marker at the midpoint of the edge when colorblind mode is enabled.
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
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
  });

  const shapeIndex = data?.shapeIndex ?? 0;
  const colorblindMode = data?.colorblindMode ?? false;
  const color = (style.stroke as string) || '#374151';

  // Offset each marker from its handle along the stalk. Vertical layouts stalk
  // along Y (top/bottom handles); horizontal layouts stalk along X (left/right
  // handles) and use half-size markers to suit the shorter horizontal segments.
  const STALK_OFFSET = 15;
  const horizontal =
    sourcePosition === Position.Left || sourcePosition === Position.Right ||
    targetPosition === Position.Left || targetPosition === Position.Right;
  const markerScale = horizontal ? 0.5 : 1;

  const sourceMarkerX = horizontal
    ? (sourcePosition === Position.Right ? sourceX + STALK_OFFSET : sourceX - STALK_OFFSET)
    : sourceX;
  const sourceMarkerY = horizontal
    ? sourceY
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
