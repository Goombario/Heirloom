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

// The Display menu's "Second name" (vertical cards): a smaller second line, a card
// 16px taller, and the dates on the card's bottom edge.
describe('portrait card second name line', () => {
    const card = (c: HTMLElement) => c.querySelector<HTMLElement>('.bg-card')!;

    it('off: no line and the 152px card', () => {
        const { container } = renderCard(PersonNode, {});
        expect(container.querySelector('.tree-card-second-name')).toBeNull();
        expect(card(container).style.height).toBe('152px');
    });

    it('on: shows the name in its own line, tagged with its script', () => {
        const { container } = renderCard(PersonNode, { secondNameOn: true, secondName: '陈伟' });
        const line = container.querySelector('.tree-card-second-name')!;
        expect(line.textContent).toBe('陈伟');
        expect(line.getAttribute('lang')).toBe('zh');
        expect(card(container).style.height).toBe('168px');
    });

    it('on with no name of that type: keeps an empty line so the row stays level', () => {
        const { container } = renderCard(PersonNode, { secondNameOn: true, secondName: null });
        expect(container.querySelector('.tree-card-second-name')!.textContent).toBe('');
        expect(card(container).style.height).toBe('168px');
    });

    it('Nickname: the main line is the original name', () => {
        const nick = { ...person, name: 'Ada “Dot” Moss' };
        const { container } = render(
            <NextIntlClientProvider locale="en" messages={en}>
                <ReactFlowProvider>
                    <PersonNode {...({ id: 'p7', data: { person: nick, secondNameOn: true, secondName: 'Dot', mainName: 'Ada Moss' } } as unknown as NodeProps<FlowNodeData>)} />
                </ReactFlowProvider>
            </NextIntlClientProvider>,
        );
        expect(container.textContent).toContain('Ada Moss');
        expect(container.textContent).not.toContain('“Dot”');
        expect(container.querySelector('.tree-card-second-name')!.textContent).toBe('Dot');
    });
});
