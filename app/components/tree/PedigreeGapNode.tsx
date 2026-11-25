import React, { memo } from 'react';
import type { NodeProps } from 'reactflow';
import type { FlowNodeData } from './types';
import { BAR_CARD_HEIGHT, BAR_CARD_WIDTH, PERSON_CARD_WIDTH, personCardHeight } from '@/lib/tree/geometry';

/**
 * An empty slot in the Even ancestors chart (#250): an unknown parent of a known
 * person. A faint dashed box of the card's size; no lines, nothing to click, and
 * hidden from screen readers (the person's own card already says who is known).
 */
const PedigreeGapNode: React.FC<NodeProps<FlowNodeData>> = ({ type, data }) => {
  const bar = type === 'pedigreeGapBar';
  return (
    <div
      aria-hidden="true"
      className="tree-pedigree-gap"
      style={{
        width: bar ? BAR_CARD_WIDTH : PERSON_CARD_WIDTH,
        height: bar ? BAR_CARD_HEIGHT : personCardHeight(!!data.secondNameOn),
      }}
    />
  );
};

export default memo(PedigreeGapNode);
