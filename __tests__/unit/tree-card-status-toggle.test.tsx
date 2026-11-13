/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ReactFlowProvider, type NodeProps } from 'reactflow';
import en from '@/messages/en.json';
import PersonNode from '@/app/components/tree/PersonNode';
import PersonBarNode from '@/app/components/tree/PersonBarNode';
import type { FlowNodeData } from '@/app/components/tree/types';

vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 1 }) }));

const person = { id: 7, name: 'Ada Moss', photoMediaId: null, sex: 'F', spouses: [], isDeceased: false };
const nodeProps = (data: Partial<FlowNodeData>) => ({ id: 'p7', data: { person, ...data } } as unknown as NodeProps<FlowNodeData>);

function renderCard(Card: React.ComponentType<NodeProps<FlowNodeData>>, data: Partial<FlowNodeData>) {
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <ReactFlowProvider><Card {...nodeProps(data)} /></ReactFlowProvider>
        </NextIntlClientProvider>,
    );
}

// The Display menu's "Show living status" (#68): off hides only the mark; the card stays.
describe('tree card living-status mark', () => {
    for (const [name, Card] of [['portrait card', PersonNode], ['bar card', PersonBarNode]] as const) {
        it(`${name}: shows the mark by default and hides only the mark when off`, () => {
            const on = renderCard(Card, {});
            expect(on.container.querySelector('.status-mark')).not.toBeNull();
            on.unmount();

            const off = renderCard(Card, { showStatusMark: false });
            expect(off.container.querySelector('.status-mark')).toBeNull();
            expect(off.container.textContent).toContain('Ada');
        });
    }
});
