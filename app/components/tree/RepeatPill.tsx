import React, { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useReactFlow } from 'reactflow';
import { READABLE_ZOOM } from '@/lib/tree/fitView';

/**
 * A repeat card (#13): a person reached again in one tree (pedigree collapse) is
 * drawn faded with a dashed outline, and this pill above it pans to their full
 * card. The repeat opens no editor of its own; a click anywhere on it goes to the
 * full card too.
 */
export function useJumpToCard(nodeId: string | undefined): () => void {
  const flow = useReactFlow();
  return useCallback(() => {
    if (!nodeId) return;
    const node = flow.getNode(nodeId);
    if (!node) return;
    const x = (node.positionAbsolute?.x ?? node.position.x) + (node.width ?? 0) / 2;
    const y = (node.positionAbsolute?.y ?? node.position.y) + (node.height ?? 0) / 2;
    flow.setCenter(x, y, { zoom: Math.max(flow.getZoom(), READABLE_ZOOM), duration: 300 });
  }, [flow, nodeId]);
}

export function RepeatPill({ onJump }: { onJump: () => void }) {
  const t = useTranslations('treeView');
  return (
    <button
      type="button"
      className="tree-repeat-chip nodrag nopan focus-ring"
      title={t('repeat_title')}
      onClick={(e) => { e.stopPropagation(); onJump(); }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {t('repeat_pill')}
    </button>
  );
}
