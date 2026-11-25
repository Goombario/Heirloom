import React from 'react';
import type { FlowNodeData } from './types';

/**
 * "How are they related?" on the tree (#256): the card's look while two people are
 * compared. Person 1 and 2 get a thick copper outline and a 1 or 2 badge, people on
 * the path between a thin one, and everyone else fades.
 */
export function relateClass(relate: FlowNodeData['relate']): string {
    if (relate === 'first' || relate === 'second') return ' tree-card--path-end';
    if (relate === 'on') return ' tree-card--path';
    if (relate === 'dim') return ' tree-card--dim';
    return '';
}

/** The 1 or 2 on person 1's and person 2's cards. The result card says who in words. */
export function RelateBadge({ relate, className = '' }: { relate: FlowNodeData['relate']; className?: string }) {
    if (relate !== 'first' && relate !== 'second') return null;
    return <span aria-hidden="true" className={`tree-relate-badge ${className}`}>{relate === 'first' ? 1 : 2}</span>;
}
