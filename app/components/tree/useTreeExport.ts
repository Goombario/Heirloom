import { useState, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { ReactFlowInstance } from 'reactflow';

/**
 * Custom React Hook: Tree Export to JPEG
 *
 * Provides JPEG export functionality for the React Flow tree visualization.
 * Handles viewport preparation, capture, and restoration.
 *
 * @returns Export functions and state
 */
export function useTreeExport() {
  const t = useTranslations('treeView');
  const [isExporting, setIsExporting] = useState(false);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Set React Flow instance reference
   */
  const setReactFlowInstance = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstanceRef.current = instance;
  }, []);

  /**
   * Export tree as JPEG image
   *
   * Process:
   * 1. Save current viewport state
   * 2. Calculate bounding box of all nodes
   * 3. Transform viewport to show entire tree at 100% zoom
   * 4. Wait for layout to settle
   * 5. Capture with html-to-image
   * 6. Restore original viewport
   * 7. Trigger download
   */
  const exportAsJPEG = useCallback(
    async (currentRootId: number) => {
      if (!reactFlowInstanceRef.current || !containerRef.current) {
        console.error('React Flow instance or container not available');
        return;
      }

      setIsExporting(true);

      try {
        const instance = reactFlowInstanceRef.current;
        const container = containerRef.current;

        // Step 1: Save current viewport and container styles
        const originalViewport = instance.getViewport();
        const originalWidth = container.style.width;
        const originalHeight = container.style.height;
        const originalOverflow = container.style.overflow;

        // Step 2: Get all nodes and calculate bounding box
        const nodes = instance.getNodes();
        if (nodes.length === 0) {
          throw new Error('No nodes to export');
        }

        // Lazy-loaded on first export, alongside html-to-image below
        const { getRectOfNodes } = await import('reactflow');
        const nodesBounds = getRectOfNodes(nodes);
        const padding = 100; // Increased padding for safety
        const exportWidth = nodesBounds.width + padding * 2;
        const exportHeight = nodesBounds.height + padding * 2;

        // Step 3: Temporarily resize container to fit entire tree
        container.style.width = `${exportWidth}px`;
        container.style.height = `${exportHeight}px`;
        container.style.overflow = 'visible';

        // Step 4: Transform viewport to show entire tree at zoom 1
        // Position so that all nodes are visible starting from top-left with padding
        instance.setViewport(
          {
            x: padding - nodesBounds.x,
            y: padding - nodesBounds.y,
            zoom: 1,
          },
          { duration: 0 } // Instant, no animation
        );

        // Step 5: Wait for layout to settle, fonts to load, and React Flow to re-render
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Step 6: Capture with html-to-image (lazy-loaded on first export)
        // Capture the React Flow wrapper element directly
        const reactFlowWrapper = container.querySelector('.react-flow') as HTMLElement;
        if (!reactFlowWrapper) {
          throw new Error('React Flow wrapper not found');
        }

        const { toJpeg } = await import('html-to-image');
        const dataUrl = await toJpeg(reactFlowWrapper, {
          quality: 0.95,
          backgroundColor: getComputedStyle(document.documentElement)
            .getPropertyValue('--color-surface').trim() || '#f3f4f6',
          pixelRatio: 2, // High DPI for clarity
          width: exportWidth,
          height: exportHeight,
          style: {
            width: `${exportWidth}px`,
            height: `${exportHeight}px`,
          },
          cacheBust: true,
          filter: (node) => {
            // Exclude controls, minimap, and attribution
            const exclusions = [
              'react-flow__controls',
              'react-flow__minimap',
              'react-flow__attribution',
              'react-flow__panel'
            ];
            if (node instanceof HTMLElement) {
              return !exclusions.some(className => node.classList?.contains(className));
            }
            return true;
          },
        });

        // Step 7: Restore original container size
        container.style.width = originalWidth;
        container.style.height = originalHeight;
        container.style.overflow = originalOverflow;

        // Step 8: Trigger download
        const link = document.createElement('a');
        link.download = `family_tree_${currentRootId}.jpg`;
        link.href = dataUrl;
        link.click();

        // Step 9: Restore original viewport with smooth animation
        await new Promise((resolve) => setTimeout(resolve, 100));
        instance.setViewport(originalViewport, { duration: 200 });
      } catch (error) {
        console.error('Failed to export tree as JPEG:', error);
        alert(t('export_failed'));
      } finally {
        setIsExporting(false);
      }
    },
    [t]
  );

  return {
    exportAsJPEG,
    isExporting,
    setReactFlowInstance,
    containerRef,
  };
}
