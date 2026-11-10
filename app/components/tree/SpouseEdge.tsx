'use client';

import React from 'react';
import { EdgeProps } from 'reactflow';
import { BranchEdgeData } from './types';

/**
 * Vertical spacing between spouse connector lanes (px).
 * Cards are PERSON_CARD_HEIGHT (145px) tall; a 14px step keeps lanes within
 * bounds for up to ~5 spouses (see lib/tree/geometry.ts).
 */
const LANE_STEP = 14;

/**
 * Custom edge for horizontal spouse connectors.
 *
 * When a person has multiple spouses each connector is drawn at a distinct Y offset
 * so the lanes are visually separated, making it easy to trace which branch color
 * belongs to which spouse without relying on color alone.
 *
 * Single-spouse nodes render at the card centre (no offset), identical to before.
 */
export default function SpouseEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style = {},
  data,
}: EdgeProps<BranchEdgeData>) {
  const spouseIndex = data?.spouseIndex ?? 0;
  const totalSpouses = data?.totalSpouses ?? 1;
  // 'x' = horizontal connector, lanes offset in Y (vertical tree layout).
  // 'y' = vertical connector, lanes offset in X (horizontal tree layout).
  const vertical = (data?.laneAxis ?? 'x') === 'y';

  // Centre the lanes around the card mid-point, perpendicular to the connector.
  const offset = (spouseIndex - (totalSpouses - 1) / 2) * LANE_STEP;
  const x1 = vertical ? sourceX + offset : sourceX;
  const y1 = vertical ? sourceY : sourceY + offset;
  const x2 = vertical ? sourceX + offset : targetX;
  const y2 = vertical ? targetY : sourceY + offset;

  const path = `M ${x1},${y1} L ${x2},${y2}`;

  // Lines to the 2nd+ spouse physically span through intermediate spouse cards.
  // Apply a fade-to-dark gradient so it's easy to trace which line belongs to which spouse.
  const needsGradient = totalSpouses > 1 && spouseIndex > 0;

  if (needsGradient) {
    const gradientId = `spouse-gradient-${id}`;
    const strokeColor = (style as React.CSSProperties & { stroke?: string }).stroke ?? '#374151';
    const { stroke: _stroke, ...restStyle } = style as React.CSSProperties & { stroke?: string };

    return (
      <>
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
          >
            <stop offset="0%" stopColor={strokeColor} stopOpacity="1" />
            <stop offset="5%" stopColor={strokeColor} stopOpacity="1" />
            <stop offset="10%" stopColor={strokeColor} stopOpacity="0.35" />
            <stop offset="90%" stopColor={strokeColor} stopOpacity="0.35" />
            <stop offset="95%" stopColor={strokeColor} stopOpacity="1" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="1" />
          </linearGradient>
        </defs>
        <path
          id={id}
          d={path}
          fill="none"
          style={{ ...restStyle, stroke: `url(#${gradientId})` }}
          className="react-flow__edge-path"
        />
      </>
    );
  }

  return (
    <path
      id={id}
      d={path}
      fill="none"
      style={style}
      className="react-flow__edge-path"
    />
  );
}
