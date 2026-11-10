'use client';

import React from 'react';
import { useNodes, useStore, Panel } from 'reactflow';
import { FlowNode, FlowNodeData } from './types';
import {
  PERSON_CARD_WIDTH, PERSON_CARD_HEIGHT,
  BAR_CARD_WIDTH, BAR_CARD_HEIGHT,
} from '@/lib/tree/geometry';

/** Card footprint per node — horizontal bars vs portrait cards. */
function dimsFor(node: FlowNode): { w: number; h: number } {
  return node.type === 'personBar'
    ? { w: BAR_CARD_WIDTH, h: BAR_CARD_HEIGHT }
    : { w: PERSON_CARD_WIDTH, h: PERSON_CARD_HEIGHT };
}

interface DebugTextProps {
  x: number;
  y: number;
  children: React.ReactNode;
  fill?: string;
  zoom: number;
}

function DebugText({ x, y, children, fill = '#00ffff', zoom }: DebugTextProps) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={10 / zoom}
      fontFamily="monospace"
      stroke="#000"
      strokeWidth={2 / zoom}
      paintOrder="stroke"
      fill={fill}
    >
      {children}
    </text>
  );
}

interface GapBracketProps {
  x1: number;
  x2: number;
  y: number;
  gap: number;
  zoom: number;
  cardH: number;
}

function GapBracket({ x1, x2, y, gap, zoom, cardH }: GapBracketProps) {
  const mid = (x1 + x2) / 2;
  const lineY = y + cardH + 14 / zoom;
  const color = gap < 0 ? '#ff4444' : '#ff9900';
  const tickH = 4 / zoom;
  const sw = 1 / zoom;

  return (
    <g>
      <line x1={x1} y1={lineY} x2={x2} y2={lineY} stroke={color} strokeWidth={sw} />
      <line x1={x1} y1={lineY - tickH} x2={x1} y2={lineY + tickH} stroke={color} strokeWidth={sw} />
      <line x1={x2} y1={lineY - tickH} x2={x2} y2={lineY + tickH} stroke={color} strokeWidth={sw} />
      <DebugText x={mid} y={lineY - 6 / zoom} fill={color} zoom={zoom}>
        {Math.round(gap)}px
      </DebugText>
    </g>
  );
}

export default function DebugOverlay() {
  const nodes = useNodes() as FlowNode[];
  const transform = useStore((s) => s.transform);
  const [panX, panY, zoom] = transform;

  // Group nodes by Y level (±5px rounding absorbs float drift)
  const yGroups = new Map<number, FlowNode[]>();
  for (const node of nodes) {
    const key = Math.round(node.position.y / 5) * 5;
    const group = yGroups.get(key) ?? [];
    group.push(node);
    yGroups.set(key, group);
  }

  const gapBrackets: { x1: number; x2: number; y: number; gap: number; cardH: number }[] = [];
  for (const group of yGroups.values()) {
    const sorted = [...group].sort((a, b) => a.position.x - b.position.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const left = sorted[i];
      const right = sorted[i + 1];
      const leftDims = dimsFor(left);
      const gap = right.position.x - (left.position.x + leftDims.w);
      gapBrackets.push({ x1: left.position.x + leftDims.w, x2: right.position.x, y: left.position.y, gap, cardH: leftDims.h });
    }
  }

  return (
    <Panel
      position="top-left"
      style={{
        margin: 0,
        padding: 0,
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      <svg width="100%" height="100%" style={{ display: 'block', overflow: 'visible' }}>
        <g transform={`translate(${panX}, ${panY}) scale(${zoom})`}>

          {/* Bounding boxes — always shown */}
          {nodes.map((node) => {
            const d = dimsFor(node);
            return (
              <rect
                key={`bb-${node.id}`}
                x={node.position.x}
                y={node.position.y}
                width={d.w}
                height={d.h}
                fill="none"
                stroke="#00ff88"
                strokeWidth={1 / zoom}
              />
            );
          })}

          {/* ID + center-coordinate labels (stacked) */}
          {nodes.map((node) => {
            const data = node.data as FlowNodeData;
            const d = dimsFor(node);
            const cx = node.position.x + d.w / 2;
            const cy = node.position.y + d.h / 2;
            const lineH = 12 / zoom;
            return (
              <g key={`id-${node.id}`}>
                <DebugText x={cx} y={node.position.y - 4 / zoom - lineH} zoom={zoom}>
                  #{data.person.id}
                </DebugText>
                <DebugText x={cx} y={node.position.y - 4 / zoom} zoom={zoom}>
                  ({Math.round(cx)}, {Math.round(cy)})
                </DebugText>
              </g>
            );
          })}

          {/* Spouse index badges */}
          {nodes
            .filter((node) => (node.data as FlowNodeData).isSpouse)
            .map((node) => {
              const data = node.data as FlowNodeData;
              const d = dimsFor(node);
              const idx = (data.spouseIndex ?? 0) + 1;
              return (
                <DebugText
                  key={`spouse-${node.id}`}
                  x={node.position.x + d.w / 2}
                  y={node.position.y + d.h - 4 / zoom}
                  fill="#ffdd00"
                  zoom={zoom}
                >
                  [S{idx}]
                </DebugText>
              );
            })}

          {/* Sibling gap brackets */}
          {gapBrackets.map(({ x1, x2, y, gap, cardH }, i) => (
            <GapBracket key={`gap-${i}`} x1={x1} x2={x2} y={y} gap={gap} zoom={zoom} cardH={cardH} />
          ))}

        </g>
      </svg>
    </Panel>
  );
}
